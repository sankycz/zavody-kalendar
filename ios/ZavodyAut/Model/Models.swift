import Foundation

// Tvar odpovědí read-only API (src/shared/types.ts). Dekóduje se s .convertFromSnakeCase.
// Neznámá hodnota výčtu nesmí shodit celý seznam, proto má každý výčet záložní hodnotu.

enum Discipline: String, Codable, CaseIterable, Identifiable, Sendable {
    case rally, rallysprint, vrch, autocross, slalom, okruh, drift, regularity, historic, jiny
    var id: String { rawValue }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Discipline(rawValue: raw) ?? .jiny
    }
}

enum Level: String, Codable, CaseIterable, Identifiable, Sendable {
    case mcr, pohar, regionalni, volny
    var id: String { rawValue }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Level(rawValue: raw) ?? .volny
    }
}

enum Status: String, Codable, Sendable {
    case planned, cancelled, finished

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Status(rawValue: raw) ?? .planned
    }
}

enum LinkKind: String, Codable, Sendable {
    case harmonogram, mapa, divaci, propozice, plakat, video, jine

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = LinkKind(rawValue: raw) ?? .jine
    }
}

/// What the organizer's own website reports, when it differs from the calendar.
enum OrganizerFlag: String, Sendable {
    case cancelled, postponed, dateChanged = "date_changed"
}

/// One race in the list (EventListItem).
struct RaceEvent: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let dateFrom: String
    let dateTo: String?
    let discipline: Discipline
    let series: String?
    let level: Level
    let locationName: String?
    let region: String?
    let country: String
    let status: Status
    let lat: Double?
    let lng: Double?
    /// Track the race is on; nil when lat/lng is only the town centre.
    let venue: String?
    let sourceCount: Int
    let organizerFlag: String?
}

extension RaceEvent {
    var flag: OrganizerFlag? { organizerFlag.flatMap(OrganizerFlag.init(rawValue:)) }
    var lastDay: String { dateTo ?? dateFrom }
    var isCancelled: Bool { status == .cancelled || flag == .cancelled }
    var hasPoint: Bool { lat != nil && lng != nil }

    /// "Autodrom Most · Most" or "Kopná · Zlínský kraj".
    var placeLine: String? {
        var parts: [String] = []
        for s in [venue, locationName, region].compactMap({ $0 }) where !parts.contains(s) {
            parts.append(s)
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

struct EventsResponse: Codable, Sendable {
    let events: [RaceEvent]
    let lastIngestAt: String?
    let seasons: [Int]?
}

struct RegionsResponse: Codable, Sendable {
    let regions: [String]
}

struct EventSourceLink: Codable, Hashable, Sendable {
    let name: String
    let url: String
    let lastSeenAt: String
}

/// A document for spectators (schedule, map, regulations…).
struct EventLink: Codable, Hashable, Sendable {
    let label: String
    let url: String
    let kind: LinkKind
}

struct OrganizerCheckInfo: Codable, Hashable, Sendable {
    let url: String
    let checkedAt: String
    let outcome: String
    let status: String?
    let dateFrom: String?
    let dateTo: String?
    let notice: String?
    let error: String?
    let changedAt: String?
}

struct StageInfo: Codable, Hashable, Sendable {
    let name: String
    let date: String?
    let firstCar: String?
    let closedFrom: String?
    let closedTo: String?
    let lengthKm: Double?
}

struct StagesInfo: Codable, Hashable, Sendable {
    let docUrl: String
    let checkedAt: String
    let items: [StageInfo]
}

struct LiveLink: Codable, Hashable, Sendable {
    let label: String
    let url: String
    let from: String
}

struct LiveLinks: Codable, Hashable, Sendable {
    let results: [LiveLink]
    let streams: [LiveLink]
}

/// GET /api/events/<id>
struct EventDetail: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let dateFrom: String
    let dateTo: String?
    let discipline: Discipline
    let series: String?
    let level: Level
    let locationName: String?
    let region: String?
    let country: String
    let status: Status
    let lat: Double?
    let lng: Double?
    let venue: String?
    let sourceCount: Int
    let organizerFlag: String?
    let organizer: String?
    let websiteUrl: String?
    let description: String?
    let updatedAt: String
    let sources: [EventSourceLink]
    let links: [EventLink]?
    let organizerCheck: OrganizerCheckInfo?
    let live: LiveLinks?
    let stages: StagesInfo?

    /// The same race as a list item (header, map, favorites).
    var summary: RaceEvent {
        RaceEvent(
            id: id, name: name, dateFrom: dateFrom, dateTo: dateTo, discipline: discipline,
            series: series, level: level, locationName: locationName, region: region,
            country: country, status: status, lat: lat, lng: lng, venue: venue,
            sourceCount: sourceCount, organizerFlag: organizerFlag
        )
    }
}
