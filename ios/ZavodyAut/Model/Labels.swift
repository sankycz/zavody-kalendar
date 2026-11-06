import SwiftUI

// Texty a barvy shodné s webem (web/src/labels.ts, Badges.tsx, closures.ts).

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

extension Discipline {
    var label: String {
        switch self {
        case .rally: return "Rally"
        case .rallysprint: return "Rallysprint"
        case .vrch: return "Závod do vrchu"
        case .autocross: return "Autokros"
        case .slalom: return "Autoslalom"
        case .okruh: return "Okruh"
        case .drift: return "Drift"
        case .regularity: return "Regularity"
        case .historic: return "Historická vozidla"
        case .jiny: return "Jiné"
        }
    }

    var color: Color {
        switch self {
        case .rally: return Color(hex: 0xEF4444)
        case .rallysprint: return Color(hex: 0xF97316)
        case .vrch: return Color(hex: 0xF59E0B)
        case .autocross: return Color(hex: 0xCA8A04)
        case .slalom: return Color(hex: 0x14B8A6)
        case .okruh: return Color(hex: 0x3B82F6)
        case .drift: return Color(hex: 0xA855F7)
        case .regularity: return Color(hex: 0x06B6D4)
        case .historic: return Color(hex: 0xA8A29E)
        case .jiny: return Color(hex: 0x64748B)
        }
    }

    /// SF Symbol for the discipline.
    var symbol: String {
        switch self {
        case .rally: return "car.fill"
        case .rallysprint: return "bolt.fill"
        case .vrch: return "mountain.2.fill"
        case .autocross: return "water.waves"
        case .slalom: return "cone.fill"
        case .okruh: return "flag.checkered"
        case .drift: return "tornado"
        case .regularity: return "stopwatch.fill"
        case .historic: return "star.fill"
        case .jiny: return "flag.fill"
        }
    }

    /// Words a visitor may search a discipline by (src/api.ts DISCIPLINE_WORDS).
    var searchWords: String {
        switch self {
        case .rally: return "rally rallye"
        case .rallysprint: return "rallysprint rally sprint"
        case .vrch: return "zavod do vrchu vrch"
        case .autocross: return "autokros autocross rallycross"
        case .slalom: return "autoslalom slalom"
        case .okruh: return "okruh okruhy"
        case .drift: return "drift"
        case .regularity: return "regularity pravidelnost"
        case .historic: return "historicka historic veterani"
        case .jiny: return ""
        }
    }

    /// Raced on public roads closed for the race (rally stages, hill climbs).
    var closesRoads: Bool { self == .rally || self == .rallysprint || self == .vrch }
}

extension Level {
    var label: String {
        switch self {
        case .mcr: return "MČR"
        case .pohar: return "Pohár / seriál"
        case .regionalni: return "Regionální"
        case .volny: return "Volný závod"
        }
    }

    var color: Color {
        switch self {
        case .mcr: return Color(hex: 0xE11D2E)
        case .pohar: return Color(hex: 0x2563EB)
        case .regionalni: return Color(hex: 0x15803D)
        case .volny: return Color(hex: 0x6B7280)
        }
    }
}

extension OrganizerFlag {
    var label: String {
        switch self {
        case .cancelled: return "Zrušeno pořadatelem"
        case .postponed: return "Odloženo"
        case .dateChanged: return "Změna termínu?"
        }
    }
}

extension LinkKind {
    var symbol: String {
        switch self {
        case .harmonogram: return "clock"
        case .mapa: return "map"
        case .divaci: return "figure.wave"
        case .propozice: return "doc.text"
        case .plakat: return "photo"
        case .video: return "play.rectangle"
        case .jine: return "link"
        }
    }
}

extension RaceEvent {
    /// Upcoming race on closed roads: warn that navigation doesn't know.
    var warnsClosedRoads: Bool {
        status == .planned && flag != .cancelled && flag != .postponed && discipline.closesRoads
    }
}

extension EventDetail {
    /// The organizer's document most likely to show the closed roads and times.
    var closureDoc: EventLink? {
        for kind in [LinkKind.divaci, .mapa, .harmonogram, .propozice] {
            if let l = links?.first(where: { $0.kind == kind }) { return l }
        }
        return nil
    }
}

extension Set {
    mutating func toggle(_ element: Element) {
        if contains(element) { remove(element) } else { insert(element) }
    }
}
