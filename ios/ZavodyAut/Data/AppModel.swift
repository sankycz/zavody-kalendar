import Foundation
import Observation

/// Filters of the list and the map, remembered between launches (like prefs-v1 on the web).
struct Filters: Codable, Equatable {
    var disciplines: Set<Discipline> = []
    var levels: Set<Level> = []
    var region: String?
    /// Only the home region (needs `homeRegion`).
    var myRegionOnly = false

    var activeCount: Int {
        disciplines.count + levels.count + (region == nil ? 0 : 1)
    }
}

enum ListMode {
    case all, favorites
}

/// Settings that stay only in this phone (no accounts, nothing goes to a server).
private struct Prefs: Codable {
    var filters = Filters()
    var homeRegion: String?
    /// Favorite race id → its last day ('YYYY-MM-DD'); forgotten 60 days after the race.
    var favorites: [String: String] = [:]
}

@MainActor
@Observable
final class AppModel {
    private(set) var events: [RaceEvent] = []
    private(set) var regions: [String] = []
    private(set) var lastIngestAt: String?
    /// Set when the list shown is the saved copy (no signal).
    private(set) var offlineSince: Date?
    private(set) var loading = false
    private(set) var loadError: String?

    var filters: Filters { didSet { save() } }
    var homeRegion: String? { didSet { save() } }
    private(set) var favorites: [String: String] { didSet { save() } }

    private static let prefsKey = "prefs-v1"
    private static let favoriteDays = 60

    init() {
        let prefs = UserDefaults.standard.data(forKey: Self.prefsKey)
            .flatMap { try? JSONDecoder().decode(Prefs.self, from: $0) } ?? Prefs()
        filters = prefs.filters
        homeRegion = prefs.homeRegion
        favorites = Self.pruned(prefs.favorites)
    }

    // MARK: Loading

    func load() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        if events.isEmpty, let saved = await API.shared.cached("/api/events", as: EventsResponse.self) {
            apply(saved)
        }
        do {
            apply(try await API.shared.get("/api/events", as: EventsResponse.self))
            loadError = nil
        } catch {
            if events.isEmpty { loadError = error.localizedDescription }
        }
        if let r = try? await API.shared.get("/api/regions", as: RegionsResponse.self) {
            regions = r.value.regions
        }
    }

    private func apply(_ fetched: Fetched<EventsResponse>) {
        events = fetched.value.events
        lastIngestAt = fetched.value.lastIngestAt
        offlineSince = fetched.savedAt
    }

    // MARK: Queries

    func event(_ id: String) -> RaceEvent? {
        events.first { $0.id == id }
    }

    func visible(mode: ListMode, search: String) -> [RaceEvent] {
        let words = Fmt.fold(search).split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
        return events.filter { e in
            switch mode {
            case .favorites:
                guard favorites[e.id] != nil else { return false }
            case .all:
                if !filters.disciplines.isEmpty && !filters.disciplines.contains(e.discipline) { return false }
                if !filters.levels.isEmpty && !filters.levels.contains(e.level) { return false }
                if filters.myRegionOnly, let home = homeRegion {
                    if e.region != home { return false }
                } else if let region = filters.region, e.region != region {
                    return false
                }
            }
            return matches(e, words)
        }
    }

    /// Every word must occur in the name, place, track, region, series or discipline.
    private func matches(_ e: RaceEvent, _ words: [String]) -> Bool {
        guard !words.isEmpty else { return true }
        let text = Fmt.fold([e.name, e.locationName, e.venue, e.region, e.series, e.discipline.searchWords]
            .compactMap { $0 }.joined(separator: " "))
        return words.allSatisfy { text.contains($0) }
    }

    /// The next race worth a big card: the nearest favorite, else the nearest race.
    var nextRace: RaceEvent? {
        let upcoming = events.filter { !$0.isCancelled && Fmt.daysUntil($0.lastDay) >= 0 }
        return upcoming.first { favorites[$0.id] != nil } ?? upcoming.first
    }

    // MARK: Favorites

    func isFavorite(_ id: String) -> Bool { favorites[id] != nil }

    func toggleFavorite(_ e: RaceEvent) {
        if favorites[e.id] == nil { favorites[e.id] = e.lastDay } else { favorites[e.id] = nil }
    }

    private static func pruned(_ favorites: [String: String]) -> [String: String] {
        favorites.filter { Fmt.daysUntil($0.value) >= -favoriteDays }
    }

    // MARK: Persistence

    private func save() {
        let prefs = Prefs(filters: filters, homeRegion: homeRegion, favorites: favorites)
        if let data = try? JSONEncoder().encode(prefs) {
            UserDefaults.standard.set(data, forKey: Self.prefsKey)
        }
    }
}
