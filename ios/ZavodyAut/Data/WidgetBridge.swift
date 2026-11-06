import Foundation
import WidgetKit

/// Hands the upcoming races and the favorites to the "Další závod" widget through the
/// shared App Group, so the widget works offline and knows the favorites (they stay in the device).
/// The widget (ios/ZavodyAutWidget) has the same `Snapshot` shape.
enum WidgetBridge {
    static let group = "group.cz.zavodyaut.app"
    static let key = "widget-v1"

    struct Race: Codable {
        let id: String
        let name: String
        let dateFrom: String
        let dateTo: String?
        let discipline: String
        let place: String?
    }

    struct Snapshot: Codable {
        let races: [Race]
        let favorites: [String]
    }

    static func publish(events: [RaceEvent], favorites: Set<String>) {
        guard let defaults = UserDefaults(suiteName: group) else { return }
        let today = Fmt.todayISO()
        let races = events
            .filter { !$0.isCancelled && $0.lastDay >= today }
            .prefix(40)
            .map { Race(id: $0.id, name: $0.name, dateFrom: $0.dateFrom, dateTo: $0.dateTo, discipline: $0.discipline.rawValue, place: $0.venue ?? $0.locationName) }
        guard let data = try? JSONEncoder().encode(Snapshot(races: Array(races), favorites: favorites.sorted())) else { return }
        if defaults.data(forKey: key) == data { return }
        defaults.set(data, forKey: key)
        WidgetCenter.shared.reloadAllTimelines()
    }
}
