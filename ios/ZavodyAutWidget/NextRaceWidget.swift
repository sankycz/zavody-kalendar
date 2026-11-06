import SwiftUI
import WidgetKit

// "Další závod": the nearest favorite race (else the nearest race) with a countdown, on the
// home screen, in Today View and on the lock screen. Data from the API, without signal from
// the snapshot the app shares through the App Group (ZavodyAut/Data/WidgetBridge.swift).

private let appGroup = "group.cz.zavodyaut.app"
private let snapshotKey = "widget-v1"

struct Race: Codable, Hashable {
    let id: String
    let name: String
    let dateFrom: String
    let dateTo: String?
    let discipline: String
    let place: String?
}

private struct Snapshot: Codable {
    let races: [Race]
    let favorites: [String]
}

/// The bits of GET /api/events the widget needs.
private struct EventsResponse: Decodable {
    struct Item: Decodable {
        let id: String
        let name: String
        let dateFrom: String
        let dateTo: String?
        let discipline: String
        let locationName: String?
        let venue: String?
        let status: String
        let organizerFlag: String?
    }

    let events: [Item]
}

// MARK: Dates (Czech time)

private enum Day {
    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Prague") ?? .current
        c.locale = Locale(identifier: "cs_CZ")
        return c
    }()

    static func date(_ iso: String) -> Date? {
        let p = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
    }

    static func iso(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func until(_ iso: String, from now: Date) -> Int {
        guard let d = date(iso) else { return 0 }
        return calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: d).day ?? 0
    }

    /// "so 12. 4." or "so 12. 4. – ne 13. 4."
    static func range(_ from: String, _ to: String?) -> String {
        let f = DateFormatter()
        f.locale = calendar.locale
        f.timeZone = calendar.timeZone
        f.dateFormat = "EEE d. M."
        guard let a = date(from) else { return from }
        guard let to, to != from, let b = date(to) else { return f.string(from: a) }
        return "\(f.string(from: a)) – \(f.string(from: b))"
    }

    /// "dnes", "zítra", "za 3 dny", "za 12 dní", "jede se"
    static func countdown(_ race: Race, now: Date) -> String {
        let d = until(race.dateFrom, from: now)
        if d < 0 { return "jede se" }
        if d == 0 { return "dnes" }
        if d == 1 { return "zítra" }
        return d < 5 ? "za \(d) dny" : "za \(d) dní"
    }
}

private func disciplineColor(_ d: String) -> Color {
    let hex: UInt32
    switch d {
    case "rally": hex = 0xEF4444
    case "rallysprint": hex = 0xF97316
    case "vrch": hex = 0xF59E0B
    case "autocross": hex = 0xCA8A04
    case "slalom": hex = 0x14B8A6
    case "okruh": hex = 0x3B82F6
    case "drift": hex = 0xA855F7
    case "regularity": hex = 0x06B6D4
    case "historic": hex = 0xA8A29E
    default: hex = 0x64748B
    }
    return Color(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
}

private let accent = Color(.sRGB, red: 225 / 255, green: 29 / 255, blue: 46 / 255)
private let accent2 = Color(.sRGB, red: 1, green: 122 / 255, blue: 24 / 255)

// MARK: Timeline

struct NextRaceEntry: TimelineEntry {
    let date: Date
    let race: Race?
    let isFavorite: Bool
    let after: [Race]
}

struct NextRaceProvider: TimelineProvider {
    func placeholder(in context: Context) -> NextRaceEntry {
        NextRaceEntry(
            date: .now,
            race: Race(id: "", name: "Rallye Šumava Klatovy", dateFrom: Day.iso(.now.addingTimeInterval(3 * 86_400)), dateTo: nil, discipline: "rally", place: "Klatovy"),
            isFavorite: true,
            after: []
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (NextRaceEntry) -> Void) {
        if context.isPreview {
            completion(placeholder(in: context))
            return
        }
        Task { completion(Self.entry(for: .now, data: await Self.load())) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NextRaceEntry>) -> Void) {
        Task {
            let data = await Self.load()
            // The countdown changes at midnight: one entry for today and each of the next days.
            let today = Day.calendar.startOfDay(for: .now)
            let entries = (0..<4).compactMap { i -> NextRaceEntry? in
                guard let day = Day.calendar.date(byAdding: .day, value: i, to: today) else { return nil }
                return Self.entry(for: i == 0 ? .now : day, data: data)
            }
            let refresh = Date.now.addingTimeInterval(6 * 3600)
            completion(Timeline(entries: entries, policy: .after(refresh)))
        }
    }

    private static func entry(for date: Date, data: Snapshot) -> NextRaceEntry {
        let today = Day.iso(date)
        let upcoming = data.races.filter { ($0.dateTo ?? $0.dateFrom) >= today }
        let favorites = Set(data.favorites)
        let race = upcoming.first { favorites.contains($0.id) } ?? upcoming.first
        let after = upcoming.filter { $0.id != race?.id }.prefix(2)
        return NextRaceEntry(date: date, race: race, isFavorite: race.map { favorites.contains($0.id) } ?? false, after: Array(after))
    }

    /// Fresh races from the API, favorites (and the races without signal) from the app.
    private static func load() async -> Snapshot {
        let defaults = UserDefaults(suiteName: appGroup)
        let shared = defaults?.data(forKey: snapshotKey).flatMap { try? JSONDecoder().decode(Snapshot.self, from: $0) }
        let favorites = shared?.favorites ?? []
        if let url = URL(string: "https://www.zavody-aut.cz/api/events"),
           let result = try? await URLSession.shared.data(from: url),
           (result.1 as? HTTPURLResponse)?.statusCode == 200 {
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            if let list = try? decoder.decode(EventsResponse.self, from: result.0) {
                let races = list.events
                    .filter { $0.status == "planned" && $0.organizerFlag != "cancelled" }
                    .map { Race(id: $0.id, name: $0.name, dateFrom: $0.dateFrom, dateTo: $0.dateTo, discipline: $0.discipline, place: $0.venue ?? $0.locationName) }
                return Snapshot(races: races, favorites: favorites)
            }
        }
        return shared ?? Snapshot(races: [], favorites: [])
    }
}

// MARK: Views

struct NextRaceWidgetView: View {
    let entry: NextRaceEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            if let race = entry.race {
                switch family {
                case .accessoryInline:
                    Text("🏁 \(race.name) · \(Day.countdown(race, now: entry.date))")
                case .accessoryRectangular:
                    VStack(alignment: .leading, spacing: 1) {
                        Text(Day.countdown(race, now: entry.date).uppercased()).font(.caption2.weight(.heavy))
                        Text(race.name).font(.headline).lineLimit(1)
                        Text(Day.range(race.dateFrom, race.dateTo)).font(.caption).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                case .systemMedium:
                    medium(race)
                default:
                    small(race)
                }
            } else {
                VStack(spacing: 6) {
                    Image(systemName: "flag.checkered").font(.title2)
                    Text("Otevřete aplikaci Závody aut").font(.caption).multilineTextAlignment(.center)
                }
                .foregroundStyle(.white)
            }
        }
        .widgetURL(entry.race.flatMap { URL(string: "zavodyaut://zavod/\($0.id)") })
        .containerBackground(for: .widget) {
            if family == .accessoryInline || family == .accessoryRectangular {
                Color.clear
            } else {
                background(entry.race?.discipline)
            }
        }
    }

    private func background(_ discipline: String?) -> some View {
        LinearGradient(
            colors: [discipline.map(disciplineColor) ?? accent, accent, Color(.sRGB, red: 11 / 255, green: 13 / 255, blue: 20 / 255)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
    }

    private func small(_ race: Race) -> some View {
        let days = Day.until(race.dateFrom, from: entry.date)
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(entry.isFavorite ? "TVŮJ ZÁVOD" : "DALŠÍ ZÁVOD").font(.caption2.weight(.heavy)).opacity(0.85)
                Spacer()
                if entry.isFavorite { Image(systemName: "star.fill").font(.caption2) }
            }
            Spacer(minLength: 0)
            if days > 1 {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("\(days)").font(.system(size: 40, weight: .black, design: .rounded)).contentTransition(.numericText(countsDown: true))
                    Text(days < 5 ? "dny" : "dní").font(.headline.weight(.bold))
                }
            } else {
                Text(Day.countdown(race, now: entry.date).uppercased()).font(.system(size: 24, weight: .black, design: .rounded))
            }
            Text(race.name).font(.subheadline.weight(.bold)).lineLimit(2)
            Text(Day.range(race.dateFrom, race.dateTo)).font(.caption2.weight(.medium)).opacity(0.85).lineLimit(1)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private func medium(_ race: Race) -> some View {
        HStack(alignment: .top, spacing: 14) {
            small(race)
            if !entry.after.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("POTOM").font(.caption2.weight(.heavy)).opacity(0.75)
                    ForEach(entry.after, id: \.id) { r in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(r.name).font(.caption.weight(.semibold)).lineLimit(1)
                            Text([Day.range(r.dateFrom, r.dateTo), r.place].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption2).opacity(0.8).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

struct NextRaceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NextRace", provider: NextRaceProvider()) { entry in
            NextRaceWidgetView(entry: entry)
        }
        .configurationDisplayName("Další závod")
        .description("Nejbližší oblíbený závod, jinak nejbližší závod, s odpočtem dní.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct ZavodyAutWidgets: WidgetBundle {
    var body: some Widget {
        NextRaceWidget()
    }
}

#Preview(as: .systemSmall) {
    NextRaceWidget()
} timeline: {
    NextRaceEntry(
        date: .now,
        race: Race(id: "x", name: "Rallye Šumava Klatovy", dateFrom: Day.iso(.now.addingTimeInterval(3 * 86_400)), dateTo: nil, discipline: "rally", place: "Klatovy"),
        isFavorite: true,
        after: []
    )
}
