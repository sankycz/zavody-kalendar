import Foundation
import MapLibre
import Observation

/// Races kept in the device for the track without signal (the web's service worker,
/// web/src/offline/plan.ts, done natively):
/// - by itself: races from today to Sunday (max 8, favorites first, no cancelled ones),
///   at most once in 6 hours and whenever the signal comes back;
/// - by hand: "Uložit offline" in the detail.
/// For each race: the detail (API cache), MapLibre offline packs of its surroundings in the
/// light and dark style, and documents for spectators (schedule, map, regulations…) through
/// our document endpoint. Once a race is over, all of it is deleted.
@MainActor
@Observable
final class OfflineStore {
    private struct Entry: Codable {
        var lastDay: String
        var manual: Bool
        /// Original document URL → file name in the race's folder.
        var docs: [String: String] = [:]
        var complete = false
    }

    private struct Manifest: Codable {
        var events: [String: Entry] = [:]
        var lastSync: Date?
    }

    private struct PackContext: Codable {
        /// Race id, or "cz" for the overview of the whole country.
        let key: String
        let style: String
    }

    private(set) var saving: Set<String> = []
    private(set) var syncing = false
    private var manifest: Manifest

    private static let maxAuto = 8
    private static let syncEvery: TimeInterval = 6 * 3600
    private static let docKinds: Set<LinkKind> = [.harmonogram, .mapa, .divaci, .propozice, .plakat]
    private static let styles = ["light", "dark"]

    private let root: URL
    private var manifestURL: URL { root.appendingPathComponent("manifest.json") }

    init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        root = support.appendingPathComponent("offline", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let url = root.appendingPathComponent("manifest.json")
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        manifest = (try? Data(contentsOf: url)).flatMap { try? decoder.decode(Manifest.self, from: $0) } ?? Manifest()
    }

    // MARK: Queries

    /// The race, its map and documents are in the device.
    func isSaved(_ id: String) -> Bool { manifest.events[id]?.complete == true }

    func isManual(_ id: String) -> Bool { manifest.events[id]?.manual == true }

    /// Our copy of a spectator document, if saved.
    func localDoc(event id: String, url: String) -> URL? {
        guard let name = manifest.events[id]?.docs[url] else { return nil }
        let file = folder(id).appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: file.path) ? file : nil
    }

    // MARK: Sync

    /// Keeps the weekend's races (and the ones saved by hand) in the device.
    func sync(from events: [RaceEvent], favorites: Set<String>, force: Bool = false) async {
        _ = await loadedPacks() // so the packs of finished races can go too
        prune()
        guard !syncing, !events.isEmpty else { return }
        if !force, let last = manifest.lastSync, Date.now.timeIntervalSince(last) < Self.syncEvery { return }
        syncing = true
        defer { syncing = false }

        for e in Self.weekendRaces(events, favorites: favorites) where manifest.events[e.id] == nil {
            manifest.events[e.id] = Entry(lastDay: e.lastDay, manual: false)
        }
        await ensureOverview()
        for id in manifest.events.keys.sorted() {
            await saveRace(id)
        }
        manifest.lastSync = .now
        persist()
    }

    /// "Uložit offline" in the detail.
    func save(_ e: RaceEvent) async {
        var entry = manifest.events[e.id] ?? Entry(lastDay: e.lastDay, manual: true)
        entry.manual = true
        manifest.events[e.id] = entry
        persist()
        await ensureOverview()
        await saveRace(e.id)
    }

    func remove(_ id: String) {
        manifest.events[id] = nil
        try? FileManager.default.removeItem(at: folder(id))
        removePacks(key: id)
        persist()
    }

    /// From today to Sunday (Czech time), favorites first, max 8, without cancelled races.
    static func weekendRaces(_ events: [RaceEvent], favorites: Set<String>, now: Date = .now) -> [RaceEvent] {
        let cal = Fmt.calendar
        let today = cal.startOfDay(for: now)
        let weekday = cal.component(.weekday, from: today) // Sunday = 1
        let toSunday = (8 - weekday) % 7
        guard let sunday = cal.date(byAdding: .day, value: toSunday, to: today) else { return [] }
        let todayISO = Fmt.todayISO(now)
        let sundayISO = Fmt.todayISO(sunday)
        let weekend = events.filter { !$0.isCancelled && $0.dateFrom <= sundayISO && $0.lastDay >= todayISO }
        let sorted = weekend.filter { favorites.contains($0.id) } + weekend.filter { !favorites.contains($0.id) }
        return Array(sorted.prefix(maxAuto))
    }

    private func saveRace(_ id: String) async {
        saving.insert(id)
        defer { saving.remove(id) }
        // Without signal the saved copy comes back: nothing new to store.
        guard let fetched = try? await API.shared.get("/api/events/\(id)", as: EventDetail.self), fetched.savedAt == nil else { return }
        let e = fetched.value
        var entry = manifest.events[id] ?? Entry(lastDay: e.dateTo ?? e.dateFrom, manual: false)
        entry.lastDay = e.dateTo ?? e.dateFrom

        if let lat = e.lat, let lng = e.lng {
            await ensurePacks(key: id, bounds: Self.around(lat: lat, lng: lng), zoom: 9...14)
            // Forecast for "Živě ze závodu" at the track without signal.
            _ = try? await API.shared.external(Forecast.url(lat: lat, lng: lng), key: Forecast.key(id), as: Forecast.self)
        }
        for link in e.links ?? [] where Self.docKinds.contains(link.kind) && localDoc(event: id, url: link.url) == nil {
            if let name = await download(event: id, url: link.url) {
                entry.docs[link.url] = name
            }
        }
        entry.complete = true
        manifest.events[id] = entry
        persist()
    }

    /// Races that are over: detail, map and documents go.
    private func prune() {
        let today = Fmt.todayISO()
        let over = manifest.events.filter { $0.value.lastDay < today }.map(\.key)
        guard !over.isEmpty else { return }
        for id in over { remove(id) }
    }

    // MARK: Documents

    /// Through GET /api/events/<id>/doc?url=… (only PDF and raster images the race links to).
    private func download(event id: String, url: String) async -> String? {
        guard var components = URLComponents(url: API.base.appendingPathComponent("api/events/\(id)/doc"), resolvingAgainstBaseURL: false) else { return nil }
        components.queryItems = [URLQueryItem(name: "url", value: url)]
        guard let source = components.url, let result = try? await URLSession.shared.data(from: source) else { return nil }
        let (data, response) = result
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
        let type = (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
        let ext: String
        if type.contains("pdf") { ext = "pdf" }
        else if type.contains("png") { ext = "png" }
        else if type.contains("jpeg") || type.contains("jpg") { ext = "jpg" }
        else if type.contains("webp") { ext = "webp" }
        else if type.contains("gif") { ext = "gif" }
        else { return nil }
        let dir = folder(id)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let name = "\(UUID().uuidString).\(ext)"
        do {
            try data.write(to: dir.appendingPathComponent(name), options: .atomic)
            return name
        } catch {
            return nil
        }
    }

    private func folder(_ id: String) -> URL {
        root.appendingPathComponent("docs", isDirectory: true).appendingPathComponent(id, isDirectory: true)
    }

    // MARK: Map tiles

    /// About ±6 km around the race (zoom 9–14; OpenFreeMap has data up to 14, MapLibre draws closer views).
    private static func around(lat: Double, lng: Double) -> MLNCoordinateBounds {
        MLNCoordinateBounds(
            sw: CLLocationCoordinate2D(latitude: lat - 0.055, longitude: lng - 0.085),
            ne: CLLocationCoordinate2D(latitude: lat + 0.055, longitude: lng + 0.085)
        )
    }

    /// The whole country at zoom 5–8 for the map overview.
    private func ensureOverview() async {
        let cz = MLNCoordinateBounds(
            sw: CLLocationCoordinate2D(latitude: 48.5, longitude: 12.0),
            ne: CLLocationCoordinate2D(latitude: 51.1, longitude: 18.9)
        )
        await ensurePacks(key: "cz", bounds: cz, zoom: 5...8)
    }

    private func ensurePacks(key: String, bounds: MLNCoordinateBounds, zoom: ClosedRange<Double>) async {
        let packs = await loadedPacks()
        for style in Self.styles {
            if let existing = packs.first(where: { Self.context($0)?.key == key && Self.context($0)?.style == style }) {
                if existing.state != .complete { existing.resume() }
                continue
            }
            let region = MLNTilePyramidOfflineRegion(
                styleURL: Basemap.style(style == "dark" ? .dark : .light),
                bounds: bounds,
                fromZoomLevel: zoom.lowerBound,
                toZoomLevel: zoom.upperBound
            )
            guard let context = try? JSONEncoder().encode(PackContext(key: key, style: style)) else { continue }
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                MLNOfflineStorage.shared.addPack(for: region, withContext: context) { pack, _ in
                    pack?.resume()
                    done.resume()
                }
            }
        }
    }

    private func removePacks(key: String) {
        for pack in MLNOfflineStorage.shared.packs ?? [] where Self.context(pack)?.key == key {
            MLNOfflineStorage.shared.removePack(pack, withCompletionHandler: nil)
        }
    }

    /// MapLibre loads the list of packs asynchronously after launch.
    private func loadedPacks() async -> [MLNOfflinePack] {
        for _ in 0..<50 {
            if let packs = MLNOfflineStorage.shared.packs { return packs }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return MLNOfflineStorage.shared.packs ?? []
    }

    private static func context(_ pack: MLNOfflinePack) -> PackContext? {
        try? JSONDecoder().decode(PackContext.self, from: pack.context)
    }

    // MARK: Persistence

    private func persist() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(manifest) {
            try? data.write(to: manifestURL, options: .atomic)
        }
    }
}
