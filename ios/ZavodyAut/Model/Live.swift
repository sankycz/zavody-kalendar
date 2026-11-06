import Foundation

// Race-day view "Živě ze závodu" (web/src/live.ts): when it shows, weather and radar.

enum LiveMode {
    /// The day before the race: the race day's daytime forecast.
    case eve
    /// While the race runs: now and the next 12 hours.
    case live
}

extension RaceEvent {
    /// .eve the day before, .live while the race runs, nil otherwise (also cancelled / postponed).
    func liveMode(today: String = Fmt.todayISO()) -> LiveMode? {
        guard status == .planned, flag != .cancelled, flag != .postponed else { return nil }
        if today >= dateFrom && today <= lastDay { return .live }
        if let start = Fmt.date(dateFrom),
           let eve = Fmt.calendar.date(byAdding: .day, value: -1, to: start),
           Fmt.todayISO(eve) == today {
            return .eve
        }
        return nil
    }
}

extension EventDetail {
    /// What the race-day view has for this race; empty = no button.
    var liveParts: [String] {
        var parts: [String] = []
        if lat != nil && lng != nil { parts.append("počasí a radar") }
        if !(live?.results.isEmpty ?? true) { parts.append("výsledky") }
        if !(live?.streams.isEmpty ?? true) { parts.append("přenos") }
        return parts
    }
}

// MARK: Weather (Open-Meteo, free for non-commercial use, CC BY 4.0)

struct Forecast: Codable, Sendable {
    struct Current: Codable, Sendable {
        let time: String
        let temperature: Double
        let precipitation: Double
        let weatherCode: Int
        let windSpeed: Double
        let windGusts: Double

        enum CodingKeys: String, CodingKey {
            case time, precipitation
            case temperature = "temperature_2m"
            case weatherCode = "weather_code"
            case windSpeed = "wind_speed_10m"
            case windGusts = "wind_gusts_10m"
        }
    }

    struct Hourly: Codable, Sendable {
        let time: [String]
        let temperature: [Double?]
        let precipitationProbability: [Int?]
        let precipitation: [Double?]
        let weatherCode: [Int?]

        enum CodingKeys: String, CodingKey {
            case time, precipitation
            case temperature = "temperature_2m"
            case precipitationProbability = "precipitation_probability"
            case weatherCode = "weather_code"
        }
    }

    let current: Current
    let hourly: Hourly

    struct Hour: Identifiable {
        let time: String
        let temp: Double
        /// Chance of rain, %.
        let chance: Int?
        /// mm in that hour.
        let rain: Double
        let code: Int
        var id: String { time }
        var hour: String { String(time.dropFirst(11).prefix(2)) }
        var wet: Bool { (chance ?? 0) >= 50 || rain >= 0.5 }
    }

    /// From now on ("live", 12 hours), the race day's daytime 7–19 h ("eve").
    func hours(_ mode: LiveMode, raceDay: String, now: Date = .now) -> [Hour] {
        let all: [Hour] = hourly.time.indices.compactMap { i in
            guard let temp = hourly.temperature[safe: i] ?? nil else { return nil }
            return Hour(
                time: hourly.time[i],
                temp: temp,
                chance: hourly.precipitationProbability[safe: i] ?? nil,
                rain: (hourly.precipitation[safe: i] ?? nil) ?? 0,
                code: (hourly.weatherCode[safe: i] ?? nil) ?? -1
            )
        }
        switch mode {
        case .eve:
            return all.filter { $0.time.hasPrefix(raceDay) && $0.hour >= "07" && $0.hour <= "19" }
        case .live:
            let current = Self.hourString(now)
            guard let from = all.firstIndex(where: { $0.time >= current }) else { return [] }
            return Array(all[from..<min(from + 12, all.count)])
        }
    }

    /// "2026-10-03T14:00" in Czech time, the format of Open-Meteo's hourly times.
    static func hourString(_ date: Date) -> String {
        let c = Fmt.calendar.dateComponents([.year, .month, .day, .hour], from: date)
        return String(format: "%04d-%02d-%02dT%02d:00", c.year ?? 0, c.month ?? 0, c.day ?? 0, c.hour ?? 0)
    }

    static func url(lat: Double, lng: Double) -> URL {
        var c = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        c.queryItems = [
            URLQueryItem(name: "latitude", value: String(format: "%.3f", lat)),
            URLQueryItem(name: "longitude", value: String(format: "%.3f", lng)),
            URLQueryItem(name: "current", value: "temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m"),
            URLQueryItem(name: "hourly", value: "temperature_2m,precipitation_probability,precipitation,weather_code"),
            URLQueryItem(name: "timezone", value: "Europe/Prague"),
            URLQueryItem(name: "forecast_days", value: "3"),
        ]
        return c.url!
    }

    /// Cache key of a race's forecast (stored with the race for offline use).
    static func key(_ eventID: String) -> String { "forecast-\(eventID)" }
}

/// WMO weather code → Czech text and SF Symbol (multicolor).
struct WeatherLook {
    let text: String
    let symbol: String

    init(_ code: Int) {
        switch code {
        case 0: (text, symbol) = ("Jasno", "sun.max.fill")
        case 1...2: (text, symbol) = ("Polojasno", "cloud.sun.fill")
        case 3: (text, symbol) = ("Zataženo", "cloud.fill")
        case 45, 48: (text, symbol) = ("Mlha", "cloud.fog.fill")
        case 51...57: (text, symbol) = ("Mrholení", "cloud.drizzle.fill")
        case 61...67: (text, symbol) = ("Déšť", "cloud.rain.fill")
        case 80...82: (text, symbol) = ("Přeháňky", "cloud.heavyrain.fill")
        case 71...77, 85, 86: (text, symbol) = ("Sněžení", "cloud.snow.fill")
        case 95...: (text, symbol) = ("Bouřky", "cloud.bolt.rain.fill")
        default: (text, symbol) = ("—", "thermometer.medium")
        }
    }
}

// MARK: Rain radar (RainViewer: free, no key, last two hours in 10-minute frames, tiles up to zoom 7)

struct RadarFrame: Codable, Sendable, Hashable {
    let time: Int
    let path: String
}

struct RadarMaps: Codable, Sendable {
    struct Radar: Codable, Sendable {
        let past: [RadarFrame]
    }

    let host: String
    let radar: Radar

    static let url = URL(string: "https://api.rainviewer.com/public/weather-maps.json")!

    /// 256 px tiles, colour scheme 2 (the only one on the free API), smoothed, with snow.
    func tileURL(_ frame: RadarFrame) -> String {
        "\(host)\(frame.path)/256/{z}/{x}/{y}/2/1_1.png"
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
