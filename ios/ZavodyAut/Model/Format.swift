import Foundation

/// Czech dates as on the web (web/src/format.ts). Race dates are 'YYYY-MM-DD' in Czech time.
enum Fmt {
    static let prague = TimeZone(identifier: "Europe/Prague") ?? .current
    static let locale = Locale(identifier: "cs_CZ")

    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = prague
        c.locale = locale
        return c
    }()

    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = prague
        f.dateFormat = format
        return f
    }

    private static let monthYearF = formatter("LLLL yyyy")
    private static let monthShortF = formatter("LLL")
    private static let weekdayF = formatter("EEE")
    private static let dayMonthF = formatter("d. M.")
    private static let shortDateF = formatter("d. M. yyyy")
    private static let longDateF = formatter("EEEE d. MMMM yyyy")
    private static let timestampF: DateFormatter = {
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = prague
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()

    /// 'YYYY-MM-DD' → midnight in Prague.
    static func date(_ iso: String) -> Date? {
        let parts = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// Today in Prague as 'YYYY-MM-DD'.
    static func todayISO(_ now: Date = .now) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func timestamp(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)
    }

    private static func capitalized(_ s: String) -> String {
        s.prefix(1).uppercased() + s.dropFirst()
    }

    /// "Květen 2026"
    static func monthHeading(_ iso: String) -> String {
        guard let d = date(iso) else { return iso }
        return capitalized(monthYearF.string(from: d))
    }

    /// "kvě"
    static func monthShort(_ iso: String) -> String {
        guard let d = date(iso) else { return "" }
        return monthShortF.string(from: d).replacingOccurrences(of: ".", with: "")
    }

    static func dayNumber(_ iso: String) -> String {
        guard let d = date(iso) else { return "" }
        return String(calendar.component(.day, from: d))
    }

    /// "so" or "so–ne"
    static func weekdays(_ from: String, _ to: String?) -> String {
        guard let a = date(from) else { return "" }
        let first = weekdayF.string(from: a)
        guard let to, to != from, let b = date(to) else { return first }
        return "\(first)–\(weekdayF.string(from: b))"
    }

    /// "22. 5." or "22. 5. – 23. 5."
    static func dateRange(_ from: String, _ to: String?) -> String {
        guard let a = date(from) else { return from }
        guard let to, to != from, let b = date(to) else { return dayMonthF.string(from: a) }
        return "\(dayMonthF.string(from: a)) – \(dayMonthF.string(from: b))"
    }

    /// "sobota 16. května 2026" or "pá 22. 5. – so 23. 5. 2026"
    static func longDateRange(_ from: String, _ to: String?) -> String {
        guard let a = date(from) else { return from }
        guard let to, to != from, let b = date(to) else { return longDateF.string(from: a) }
        return "\(weekdayF.string(from: a)) \(dayMonthF.string(from: a)) – \(weekdayF.string(from: b)) \(shortDateF.string(from: b))"
    }

    static func shortDate(_ iso: String) -> String {
        guard let d = date(iso) else { return iso }
        return shortDateF.string(from: d)
    }

    static func formatTimestamp(_ iso: String) -> String {
        guard let d = timestamp(iso) else { return iso }
        return timestampF.string(from: d)
    }

    static func formatTimestamp(_ date: Date) -> String {
        timestampF.string(from: date)
    }

    /// Days from today to the start; negative when it already started.
    static func daysUntil(_ iso: String, now: Date = .now) -> Int {
        guard let d = date(iso) else { return 0 }
        let today = calendar.startOfDay(for: now)
        return calendar.dateComponents([.day], from: today, to: d).day ?? 0
    }

    /// "dnes", "zítra", "právě probíhá", "za 3 dny", "za 9 dní" or nil.
    static func relativeDay(_ from: String, _ to: String?, now: Date = .now) -> String? {
        let d = daysUntil(from, now: now)
        if d == 0 { return "dnes" }
        if d == 1 { return "zítra" }
        if d < 0, let to, daysUntil(to, now: now) >= 0 { return "právě probíhá" }
        if d > 1 && d < 5 { return "za \(d) dny" }
        if d >= 5 && d <= 14 { return "za \(d) dní" }
        return nil
    }

    /// "08:04" → "8:04"
    static func shortTime(_ t: String) -> String {
        t.hasPrefix("0") && t.count == 5 ? String(t.dropFirst()) : t
    }

    /// Lowercased, without diacritics: 'Železné hory' → 'zelezne hory'.
    static func fold(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: locale).lowercased()
    }
}
