import Foundation

/// A response and, when it came from the copy saved in the phone, when that copy was saved.
struct Fetched<T: Sendable>: Sendable {
    let value: T
    /// nil = fresh from the network; a date = no signal, the saved copy from then.
    let savedAt: Date?
}

enum APIError: LocalizedError {
    case http(Int)
    case notFound

    var errorDescription: String? {
        switch self {
        case .http(let code): return "Server odpověděl chybou \(code)."
        case .notFound: return "Závod nenalezen."
        }
    }
}

/// Read-only API of www.zavody-aut.cz. Every successful response is kept in Application
/// Support, so what the app showed once also works without signal at the track
/// (network first with a short timeout: weak signal is worse than none).
actor API {
    static let shared = API()
    static let base = URL(string: "https://www.zavody-aut.cz")!

    /// Public web page of a race (sharing, calendar entry).
    static func pageURL(_ id: String) -> URL {
        base.appendingPathComponent("zavod").appendingPathComponent(id)
    }

    private let session: URLSession
    private let dir: URL
    private let decoder: JSONDecoder
    /// Outside services (Open-Meteo, RainViewer) keep their own key names.
    private let plainDecoder = JSONDecoder()

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 6
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpAdditionalHeaders = ["Accept": "application/json"]
        session = URLSession(configuration: config)

        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        dir = support.appendingPathComponent("api", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        decoder = d
    }

    /// Network first; without signal (or on a server error) the saved copy.
    func get<T: Decodable & Sendable>(_ path: String, as type: T.Type) async throws -> Fetched<T> {
        guard let url = URL(string: path, relativeTo: Self.base)?.absoluteURL else { throw APIError.notFound }
        return try await fetch(url, key: path, as: type, plain: false)
    }

    /// An outside service (weather, radar) with the same network-first, saved-copy behaviour.
    func external<T: Decodable & Sendable>(_ url: URL, key: String, as type: T.Type) async throws -> Fetched<T> {
        try await fetch(url, key: key, as: type, plain: true)
    }

    private func fetch<T: Decodable & Sendable>(_ url: URL, key: String, as type: T.Type, plain: Bool) async throws -> Fetched<T> {
        let file = cacheFile(key)
        do {
            let (data, response) = try await session.data(from: url)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if code == 404 { throw APIError.notFound }
            guard (200..<300).contains(code) else { throw APIError.http(code) }
            let value = try (plain ? plainDecoder : decoder).decode(T.self, from: data)
            try? data.write(to: file, options: .atomic)
            return Fetched(value: value, savedAt: nil)
        } catch APIError.notFound {
            throw APIError.notFound
        } catch {
            if let saved = cached(key, as: type, plain: plain) { return saved }
            throw error
        }
    }

    /// The saved copy only (instant start before the network answers).
    func cached<T: Decodable & Sendable>(_ path: String, as type: T.Type, plain: Bool = false) -> Fetched<T>? {
        let file = cacheFile(path)
        guard let data = try? Data(contentsOf: file),
              let value = try? (plain ? plainDecoder : decoder).decode(T.self, from: data) else { return nil }
        let modified = (try? FileManager.default.attributesOfItem(atPath: file.path))?[.modificationDate] as? Date
        return Fetched(value: value, savedAt: modified ?? .now)
    }

    func isSaved(_ path: String) -> Bool {
        FileManager.default.fileExists(atPath: cacheFile(path).path)
    }

    private func cacheFile(_ path: String) -> URL {
        let name = path.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? String($0) : "_" }.joined()
        return dir.appendingPathComponent(name).appendingPathExtension("json")
    }
}
