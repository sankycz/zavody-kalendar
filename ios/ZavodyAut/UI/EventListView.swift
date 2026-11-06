import SwiftUI

/// Upcoming races grouped by month. One column on iPhone, a grid on iPad and Mac.
/// Cards grow into the detail (zoom transition) and fade as they scroll off.
struct EventListView: View {
    let mode: ListMode

    @Environment(AppModel.self) private var model
    @Namespace private var zoom
    @State private var search = ""
    @State private var showFilters = false
    @State private var appeared = false

    private let columns = [GridItem(.adaptive(minimum: 340, maximum: 560), spacing: 14, alignment: .top)]

    var body: some View {
        let events = model.visible(mode: mode, search: search)
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                if let next = heroRace {
                    NavigationLink(value: EventRoute(id: next.id, source: "hero")) {
                        NextRaceCard(event: next, isFavorite: model.isFavorite(next.id))
                    }
                    .buttonStyle(PressStyle())
                    .matchedTransitionSource(id: "hero-\(next.id)", in: zoom)
                    .reveal(0, visible: appeared)
                }
                if events.isEmpty {
                    emptyState
                } else {
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 14, pinnedViews: [.sectionHeaders]) {
                        ForEach(Self.months(events), id: \.key) { month in
                            Section {
                                ForEach(month.events) { e in
                                    card(e)
                                }
                            } header: {
                                MonthHeader(title: Fmt.monthHeading(month.key + "-01"), count: month.events.count)
                            }
                        }
                    }
                }
                footer
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
            .frame(maxWidth: 1200)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.immediately)
        .background { RacingBackground() }
        .navigationTitle(mode == .all ? "Závody aut" : "Oblíbené")
        .searchable(text: $search, prompt: "Závod, obec, trať, seriál")
        .refreshable { await model.load() }
        .toolbar {
            if mode == .all {
                ToolbarItem(placement: .primaryAction) { FilterButton(showFilters: $showFilters) }
            }
        }
        .sheet(isPresented: $showFilters) {
            FilterSheet()
                .presentationDetents([.medium, .large])
                .presentationBackground(.regularMaterial)
        }
        .navigationDestination(for: EventRoute.self) { route in
            EventDetailView(id: route.id)
                .navigationTransition(.zoom(sourceID: route.source == "hero" ? "hero-\(route.id)" : route.id, in: zoom))
        }
        .overlay {
            if model.events.isEmpty && model.loading {
                ProgressView("Načítám závody…").padding(24).glassCard()
            }
        }
        .onAppear { appeared = true }
        .sensoryFeedback(.selection, trigger: model.filters)
    }

    private func card(_ e: RaceEvent) -> some View {
        NavigationLink(value: EventRoute(id: e.id)) {
            EventCard(event: e)
        }
        .buttonStyle(PressStyle())
        .matchedTransitionSource(id: e.id, in: zoom)
        .scrollTransition(.interactive, axis: .vertical) { content, phase in
            content
                .opacity(phase.isIdentity ? 1 : 0.35)
                .scaleEffect(phase.isIdentity ? 1 : 0.94)
                .blur(radius: phase.isIdentity ? 0 : 1.5)
        }
        .contextMenu {
            Button {
                model.toggleFavorite(e)
            } label: {
                Label(model.isFavorite(e.id) ? "Odebrat z oblíbených" : "Do oblíbených", systemImage: "star")
            }
            ShareLink(item: API.pageURL(e.id), subject: Text(e.name)) {
                Label("Sdílet", systemImage: "square.and.arrow.up")
            }
        }
    }

    private var heroRace: RaceEvent? {
        guard mode == .all, search.isEmpty, model.filters.activeCount == 0, !model.filters.myRegionOnly else { return nil }
        return model.nextRace
    }

    @ViewBuilder private var header: some View {
        if let since = model.offlineSince {
            OfflineBadge(since: since)
        }
        if mode == .all, model.homeRegion != nil || model.filters.activeCount > 0 {
            QuickChips()
        }
    }

    @ViewBuilder private var emptyState: some View {
        if let error = model.loadError {
            ContentUnavailableView {
                Label("Závody se nepodařilo načíst", systemImage: "wifi.exclamationmark")
            } description: {
                Text(error)
            } actions: {
                Button("Zkusit znovu") { Task { await model.load() } }
                    .buttonStyle(.borderedProminent)
            }
            .padding(.top, 40)
        } else if !model.events.isEmpty {
            if mode == .favorites && search.isEmpty {
                ContentUnavailableView(
                    "Zatím žádné oblíbené",
                    systemImage: "star",
                    description: Text("Hvězdičkou u závodu si ho uložíte sem. Oblíbené zůstávají jen v tomhle zařízení.")
                )
                .padding(.top, 40)
            } else {
                ContentUnavailableView.search(text: search)
                    .padding(.top, 40)
            }
        }
    }

    @ViewBuilder private var footer: some View {
        if let last = model.lastIngestAt, !model.events.isEmpty {
            Text("Data ze zdrojů aktualizována \(Fmt.formatTimestamp(last))")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
        }
    }

    private struct Month {
        let key: String
        let events: [RaceEvent]
    }

    private static func months(_ events: [RaceEvent]) -> [Month] {
        var out: [Month] = []
        for e in events {
            let key = String(e.dateFrom.prefix(7))
            if let last = out.last, last.key == key {
                out[out.count - 1] = Month(key: key, events: last.events + [e])
            } else {
                out.append(Month(key: key, events: [e]))
            }
        }
        return out
    }
}

private struct MonthHeader: View {
    let title: String
    let count: Int

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.system(.title3, design: .rounded, weight: .bold))
            Text("\(count)")
                .font(.caption.weight(.bold))
                .monospacedDigit()
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(.secondary.opacity(0.15), in: Capsule())
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.bar, in: Capsule())
        .padding(.top, 6)
    }
}

/// "Můj kraj" and the active filters under the title, each one tap away.
private struct QuickChips: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if let home = model.homeRegion {
                    chip(model.filters.myRegionOnly ? "Můj kraj: \(home)" : "Můj kraj", symbol: "house.fill", on: model.filters.myRegionOnly) {
                        model.filters.myRegionOnly.toggle()
                    }
                }
                ForEach(Discipline.allCases.filter { model.filters.disciplines.contains($0) }) { d in
                    chip(d.label, symbol: "xmark", on: true) { model.filters.disciplines.remove(d) }
                }
                ForEach(Level.allCases.filter { model.filters.levels.contains($0) }) { l in
                    chip(l.label, symbol: "xmark", on: true) { model.filters.levels.remove(l) }
                }
                if let region = model.filters.region, !model.filters.myRegionOnly {
                    chip(region, symbol: "xmark", on: true) { model.filters.region = nil }
                }
            }
            .padding(.vertical, 2)
        }
        .scrollClipDisabled()
    }

    private func chip(_ text: String, symbol: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button {
            withAnimation(Theme.spring) { action() }
        } label: {
            Label(text, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .foregroundStyle(on ? Color.white : Color.primary)
                .background {
                    if on { Capsule().fill(Theme.racing) } else { Capsule().fill(.regularMaterial) }
                }
        }
        .buttonStyle(PressStyle())
    }
}

struct FilterButton: View {
    @Binding var showFilters: Bool
    @Environment(AppModel.self) private var model

    var body: some View {
        let count = model.filters.activeCount
        Button {
            showFilters = true
        } label: {
            Image(systemName: count > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                .symbolEffect(.bounce, value: count)
                .overlay(alignment: .topTrailing) {
                    if count > 0 {
                        Text("\(count)")
                            .font(.caption2.weight(.heavy))
                            .foregroundStyle(.white)
                            .padding(4)
                            .background(Theme.accent, in: Circle())
                            .offset(x: 8, y: -8)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
        }
        .accessibilityLabel(count > 0 ? "Filtry, aktivní \(count)" : "Filtry")
    }
}
