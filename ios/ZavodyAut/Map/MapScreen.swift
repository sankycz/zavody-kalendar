import SwiftUI

/// All races of the list (same filters) on the map with a strip of cards at the bottom (web/src/MapView.tsx).
/// Tapping a dot scrolls the strip to its race, swiping the strip flies the map to the race in the middle.
struct MapScreen: View {
    @Environment(AppModel.self) private var model
    @State private var focus: MapFocus?
    @State private var scrolled: String?
    @State private var seq = 0
    @State private var overview = 0
    @State private var showFilters = false

    /// Card strip plus the tab bar under it; the map keeps this area free.
    private static let stripInset: CGFloat = 220

    var body: some View {
        let events = model.visible(mode: .all, search: "")
        let located = events.filter { $0.lat != nil && $0.lng != nil }
        ZStack(alignment: .bottom) {
            RaceMapView(events: events, focus: focus, overview: overview, bottomInset: Self.stripInset) { id in
                choose(id, fly: true)
                withAnimation(Theme.spring) { scrolled = id }
            }
            .ignoresSafeArea(edges: [.horizontal, .bottom])

            if located.isEmpty {
                Text("Žádný závod se známou polohou.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .glassCard(radius: 18)
                    .padding(16)
            } else {
                strip(located)
            }
        }
        .onChange(of: located.map(\.id), initial: true) { _, ids in
            // Start at the first race of the list (the next one); it is only highlighted, the map stays.
            guard let first = ids.first, !ids.contains(focus?.id ?? "") else { return }
            choose(first, fly: false)
            scrolled = first
        }
        .onChange(of: scrolled) { _, id in
            if let id, id != focus?.id { choose(id, fly: true) }
        }
        .overlay(alignment: .top) {
            if let since = model.offlineSince {
                OfflineBadge(since: since).padding(.top, 8)
            }
        }
        .navigationTitle("Mapa")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { overview += 1 } label: {
                    Label("Celá ČR", systemImage: "arrow.down.right.and.arrow.up.left")
                }
            }
            ToolbarItem(placement: .primaryAction) { FilterButton(showFilters: $showFilters) }
        }
        .sheet(isPresented: $showFilters) {
            FilterSheet()
                .presentationDetents([.medium, .large])
                .presentationBackground(.regularMaterial)
        }
        .navigationDestination(for: EventRoute.self) { route in
            EventDetailView(id: route.id)
        }
        .sensoryFeedback(.selection, trigger: focus?.id)
    }

    private func choose(_ id: String, fly: Bool) {
        seq += 1
        focus = MapFocus(id: id, fly: fly, seq: seq)
    }

    private func strip(_ located: [RaceEvent]) -> some View {
        GeometryReader { proxy in
            let cardWidth = min(proxy.size.width * 0.84, 360)
            ScrollView(.horizontal) {
                LazyHStack(alignment: .bottom, spacing: 10) {
                    ForEach(located) { e in
                        NavigationLink(value: EventRoute(id: e.id, source: "map")) {
                            EventCard(event: e)
                        }
                        .buttonStyle(PressStyle())
                        .frame(width: cardWidth)
                        .id(e.id)
                        .scrollTransition(.interactive, axis: .horizontal) { card, phase in
                            card.scaleEffect(phase.isIdentity ? 1 : 0.94).opacity(phase.isIdentity ? 1 : 0.85)
                        }
                    }
                }
                .scrollTargetLayout()
            }
            .contentMargins(.horizontal, (proxy.size.width - cardWidth) / 2, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition(id: $scrolled, anchor: .center)
            .scrollIndicators(.hidden)
            .frame(height: proxy.size.height, alignment: .bottom)
        }
        .frame(height: 170)
        .padding(.bottom, 8)
    }
}
