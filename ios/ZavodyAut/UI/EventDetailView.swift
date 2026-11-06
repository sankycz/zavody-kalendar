import QuickLook
import SwiftUI

/// Race detail: everything the calendar knows, where to go, closed roads and stages,
/// documents for spectators and the sources. The header shows at once from the list.
struct EventDetailView: View {
    let id: String

    @Environment(AppModel.self) private var model
    @Environment(OfflineStore.self) private var offline
    @Environment(Connectivity.self) private var connectivity
    @Environment(\.openURL) private var openURL
    @State private var detail: EventDetail?
    @State private var savedAt: Date?
    @State private var error: String?
    @State private var calendar: CalendarDraft?
    @State private var appeared = false
    @State private var preview: URL?

    var body: some View {
        let summary = detail?.summary ?? model.event(id)
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let summary {
                    DetailHero(event: summary)
                        .reveal(0, visible: appeared)
                }
                if let since = savedAt {
                    OfflineBadge(since: since)
                }
                if let detail {
                    content(detail)
                } else if let error {
                    ContentUnavailableView {
                        Label("Závod se nepodařilo načíst", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Zkusit znovu") { Task { await load() } }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                }
            }
            .padding(16)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .background { RacingBackground() }
        .navigationTitle(summary?.name ?? "Závod")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let summary {
                ToolbarItemGroup(placement: .primaryAction) {
                    ShareLink(item: API.pageURL(summary.id), subject: Text(summary.name), message: Text(shareText(summary)))
                    FavoriteButton(event: summary)
                }
            }
        }
        .task(id: id) { await load() }
        .onAppear { appeared = true }
        .quickLookPreview($preview)
        .sheet(item: $calendar) { draft in
            CalendarEditor(draft: draft) { calendar = nil }
                .ignoresSafeArea()
        }
    }

    private func load() async {
        error = nil
        do {
            let fetched = try await API.shared.get("/api/events/\(id)", as: EventDetail.self)
            withAnimation(Theme.spring) {
                detail = fetched.value
                savedAt = fetched.savedAt
            }
        } catch {
            if detail == nil { self.error = error.localizedDescription }
        }
    }

    private func shareText(_ e: RaceEvent) -> String {
        [e.name, Fmt.dateRange(e.dateFrom, e.dateTo), e.locationName].compactMap { $0 }.joined(separator: " · ")
    }

    // MARK: Content

    @ViewBuilder private func content(_ e: EventDetail) -> some View {
        let s = e.summary
        warnings(e).reveal(1, visible: appeared)
        actions(e).reveal(2, visible: appeared)
        if s.hasPoint {
            RaceMapView(events: [s], interactive: false)
                .frame(height: 190)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(alignment: .bottomLeading) {
                    if s.venue == nil {
                        Text("Poloha je střed obce, trať může být jinde.")
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(.regularMaterial, in: Capsule())
                            .padding(10)
                    }
                }
                .reveal(3, visible: appeared)
        }
        info(e).reveal(4, visible: appeared)
        offlineCard(e).reveal(5, visible: appeared)
        if s.warnsClosedRoads {
            closures(e).reveal(5, visible: appeared)
        }
        if let links = e.links, !links.isEmpty {
            spectatorLinks(e.id, links).reveal(6, visible: appeared)
        }
        if let text = e.description, !text.isEmpty {
            Card(title: "O závodě") {
                Text(text).font(.body).textSelection(.enabled)
            }
            .reveal(7, visible: appeared)
        }
        sources(e).reveal(8, visible: appeared)
    }

    @ViewBuilder private func warnings(_ e: EventDetail) -> some View {
        let s = e.summary
        if s.isCancelled {
            Banner(symbol: "xmark.octagon.fill", color: .red, title: s.flag == .cancelled ? OrganizerFlag.cancelled.label : "Závod je zrušený",
                   text: e.organizerCheck?.notice)
        } else if let flag = s.flag, let check = e.organizerCheck {
            Banner(symbol: "exclamationmark.triangle.fill", color: .orange, title: flag.label,
                   text: [check.dateFrom.map { "Pořadatel uvádí \(Fmt.dateRange($0, check.dateTo))." }, check.notice]
                       .compactMap { $0 }.joined(separator: " "))
        } else if let notice = e.organizerCheck?.notice, !notice.isEmpty {
            Banner(symbol: "info.circle.fill", color: .blue, title: "Od pořadatele", text: notice)
        }
    }

    private func actions(_ e: EventDetail) -> some View {
        let s = e.summary
        return HStack(spacing: 10) {
            if let lat = s.lat, let lng = s.lng {
                ActionTile(title: "Navigovat", symbol: "car.fill", color: Theme.accent) {
                    if let url = URL(string: "https://maps.apple.com/?daddr=\(lat),\(lng)&dirflg=d") { openURL(url) }
                }
            }
            if !s.isCancelled {
                ActionTile(title: "Do kalendáře", symbol: "calendar.badge.plus", color: .blue) {
                    calendar = CalendarDraft(e)
                }
            }
            if let web = e.websiteUrl, let url = URL(string: web) {
                ActionTile(title: "Web", symbol: "safari.fill", color: .teal) { openURL(url) }
            }
        }
    }

    private func info(_ e: EventDetail) -> some View {
        Card(title: "Přehled") {
            VStack(alignment: .leading, spacing: 12) {
                InfoRow(symbol: "calendar", label: "Termín", value: Fmt.longDateRange(e.dateFrom, e.dateTo))
                if let venue = e.venue { InfoRow(symbol: "flag.checkered", label: "Trať", value: venue) }
                if let place = e.locationName { InfoRow(symbol: "mappin.and.ellipse", label: "Obec", value: place) }
                if let region = e.region { InfoRow(symbol: "map", label: "Kraj", value: region) }
                if let series = e.series { InfoRow(symbol: "trophy", label: "Seriál", value: series) }
                if let organizer = e.organizer { InfoRow(symbol: "person.2", label: "Pořadatel", value: organizer) }
            }
        }
    }

    private func closures(_ e: EventDetail) -> some View {
        Card(title: "Uzavřené silnice") {
            VStack(alignment: .leading, spacing: 12) {
                Label {
                    Text("Trať je uzavřená hodiny předem a i mezi průjezdy. Navigace o tom neví, na místo vyrazte s rezervou.")
                } icon: {
                    Image(systemName: "road.lanes").foregroundStyle(.orange)
                }
                .font(.subheadline)
                if let stages = e.stages, !stages.items.isEmpty {
                    StagesList(stages: stages)
                }
                if let doc = e.stages.flatMap({ URL(string: $0.docUrl) }) ?? e.closureDoc.flatMap({ URL(string: $0.url) }) ?? e.websiteUrl.flatMap({ URL(string: $0) }) {
                    Link(destination: doc) {
                        Label("Dokument pořadatele", systemImage: "doc.text.magnifyingglass")
                            .font(.subheadline.weight(.semibold))
                    }
                }
            }
        }
    }

    /// Without signal a saved document opens from the device, with signal the organizer's web.
    private func open(_ url: URL, event id: String, original: String) {
        if !connectivity.online, let local = offline.localDoc(event: id, url: original) {
            preview = local
        } else {
            openURL(url)
        }
    }

    private func spectatorLinks(_ id: String, _ links: [EventLink]) -> some View {
        Card(title: "Pro diváky") {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(links.enumerated()), id: \.offset) { i, l in
                    if let url = URL(string: l.url) {
                        Button { open(url, event: id, original: l.url) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: l.kind.symbol)
                                    .frame(width: 28, height: 28)
                                    .background(Theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    .foregroundStyle(Theme.accent)
                                Text(l.label).foregroundStyle(.primary).multilineTextAlignment(.leading)
                                Spacer()
                                if offline.localDoc(event: id, url: l.url) != nil {
                                    Image(systemName: "arrow.down.circle.fill")
                                        .foregroundStyle(.green)
                                        .accessibilityLabel("Uloženo v zařízení")
                                }
                                Image(systemName: "arrow.up.right").font(.caption.weight(.bold)).foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 9)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if i < links.count - 1 { Divider() }
                    }
                }
            }
        }
    }

    /// "Bez signálu": saved races work at the track without signal; others can be saved by hand.
    @ViewBuilder private func offlineCard(_ e: EventDetail) -> some View {
        let saved = offline.isSaved(e.id)
        let saving = offline.saving.contains(e.id)
        if saved || (!e.summary.isCancelled && Fmt.daysUntil(e.dateTo ?? e.dateFrom) >= 0) {
            Card(title: "Bez signálu") {
                VStack(alignment: .leading, spacing: 12) {
                    if saved {
                        Label {
                            Text("Závod je uložený v zařízení: detail, mapa okolí a dokumenty pro diváky fungují i bez signálu.")
                        } icon: {
                            Image(systemName: "checkmark.icloud.fill").foregroundStyle(.green)
                        }
                        .font(.subheadline)
                        if offline.isManual(e.id) {
                            Button("Odebrat z uložených", role: .destructive) {
                                withAnimation(Theme.spring) { offline.remove(e.id) }
                            }
                            .font(.subheadline)
                        }
                    } else if saving {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Ukládám závod, mapu a dokumenty…").font(.subheadline)
                        }
                    } else {
                        Text("U trati často není signál. Závody nejbližšího víkendu se ukládají samy, tenhle si můžete uložit hned.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Button {
                            Task { await offline.save(e.summary) }
                        } label: {
                            Label("Uložit offline", systemImage: "arrow.down.circle.fill")
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.accent)
                        .disabled(!connectivity.online)
                    }
                }
                .animation(Theme.spring, value: saved)
                .animation(Theme.spring, value: saving)
            }
            .sensoryFeedback(.success, trigger: saved)
        }
    }

    private func sources(_ e: EventDetail) -> some View {
        Card(title: "Zdroje") {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(e.sources, id: \.url) { s in
                    if let url = URL(string: s.url) {
                        Link(destination: url) {
                            Label(s.name, systemImage: "link")
                                .font(.subheadline)
                                .multilineTextAlignment(.leading)
                        }
                    }
                }
                Text("Aktualizováno \(Fmt.formatTimestamp(e.updatedAt))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: Building blocks

private struct DetailHero: View {
    let event: RaceEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                DisciplinePill(discipline: event.discipline, onColor: true)
                LevelPill(level: event.level, onColor: true)
            }
            Text(event.name)
                .font(.system(.largeTitle, design: .rounded, weight: .heavy))
                .foregroundStyle(.white)
                .strikethrough(event.isCancelled)
                .fixedSize(horizontal: false, vertical: true)
            Label(Fmt.longDateRange(event.dateFrom, event.dateTo), systemImage: "calendar")
            if let place = event.placeLine {
                Label(place, systemImage: "mappin.and.ellipse")
            }
            if let rel = Fmt.relativeDay(event.dateFrom, event.dateTo), !event.isCancelled {
                Text(rel.uppercased())
                    .font(.caption.weight(.heavy))
                    .tracking(0.8)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(.white.opacity(0.22), in: Capsule())
            }
        }
        .font(.subheadline.weight(.medium))
        .foregroundStyle(.white.opacity(0.92))
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack(alignment: .topTrailing) {
                LinearGradient(colors: [event.discipline.color, Theme.accent.opacity(0.9), Theme.ink], startPoint: .topLeading, endPoint: .bottomTrailing)
                CheckeredPattern(square: 12)
                    .frame(width: 96)
                    .opacity(0.12)
                    .mask(LinearGradient(colors: [.black, .clear], startPoint: .trailing, endPoint: .leading))
                Image(systemName: event.discipline.symbol)
                    .font(.system(size: 110, weight: .black))
                    .foregroundStyle(.white.opacity(0.1))
                    .rotationEffect(.degrees(-12))
                    .offset(x: 18, y: 30)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: event.discipline.color.opacity(0.4), radius: 24, x: 0, y: 14)
    }
}

private struct Card<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title.uppercased())
                .font(.caption.weight(.heavy))
                .tracking(1)
                .foregroundStyle(.secondary)
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard()
    }
}

private struct InfoRow: View {
    let symbol: String
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: symbol)
                .foregroundStyle(Theme.accent)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Text(value).font(.body).textSelection(.enabled)
            }
        }
    }
}

private struct Banner: View {
    let symbol: String
    let color: Color
    let title: String
    let text: String?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(color)
                .symbolEffect(.pulse, options: .repeat(2))
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                if let text, !text.isEmpty { Text(text).font(.subheadline).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(color.opacity(0.35)))
    }
}

private struct ActionTile: View {
    let title: String
    let symbol: String
    let color: Color
    let action: () -> Void
    @State private var taps = 0

    var body: some View {
        Button {
            taps += 1
            action()
        } label: {
            VStack(spacing: 6) {
                Image(systemName: symbol)
                    .font(.title3.weight(.semibold))
                    .symbolEffect(.bounce, value: taps)
                Text(title).font(.caption.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(color)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .glassCard(radius: 18, tint: color)
        }
        .buttonStyle(PressStyle())
        .sensoryFeedback(.impact(weight: .light), trigger: taps)
    }
}

/// Stages (RZ) by day: first car, road closed from–to, length.
private struct StagesList: View {
    let stages: StagesInfo

    private var days: [(date: String?, items: [StageInfo])] {
        var out: [(date: String?, items: [StageInfo])] = []
        for s in stages.items {
            if let last = out.last, last.date == s.date {
                out[out.count - 1].items.append(s)
            } else {
                out.append((date: s.date, items: [s]))
            }
        }
        return out
    }

    /// "Uzavřeno 7:30–12:15"
    private func closedText(_ s: StageInfo) -> String? {
        guard let from = s.closedFrom else { return nil }
        guard let to = s.closedTo else { return "Uzavřeno od \(Fmt.shortTime(from))" }
        return "Uzavřeno \(Fmt.shortTime(from))–\(Fmt.shortTime(to))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(days.enumerated()), id: \.offset) { _, day in
                VStack(alignment: .leading, spacing: 6) {
                    if let date = day.date {
                        Text(Fmt.longDateRange(date, nil)).font(.subheadline.weight(.bold))
                    }
                    ForEach(Array(day.items.enumerated()), id: \.offset) { _, s in
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.name).font(.subheadline.weight(.semibold))
                                if let closed = closedText(s) {
                                    Text(closed)
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                }
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                if let first = s.firstCar {
                                    Text("1. vůz \(Fmt.shortTime(first))").font(.caption.weight(.semibold)).monospacedDigit()
                                }
                                if let km = s.lengthKm {
                                    Text(String(format: "%.2f km", km)).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .padding(10)
                        .background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
            }
            Text("Podle dokumentu pořadatele, ověřeno \(Fmt.formatTimestamp(stages.checkedAt)).")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
