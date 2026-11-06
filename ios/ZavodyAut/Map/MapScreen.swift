import SwiftUI

/// All races of the list (same filters) on the map; a tapped dot slides its card up.
struct MapScreen: View {
    @Environment(AppModel.self) private var model
    @State private var selected: String?
    @State private var showFilters = false

    var body: some View {
        let events = model.visible(mode: .all, search: "")
        ZStack(alignment: .bottom) {
            RaceMapView(events: events) { id in
                withAnimation(Theme.spring) { selected = id }
            }
            .ignoresSafeArea(edges: [.horizontal, .bottom])

            if let id = selected, let e = model.event(id) {
                NavigationLink(value: EventRoute(id: e.id, source: "map")) {
                    EventCard(event: e)
                }
                .buttonStyle(PressStyle())
                .frame(maxWidth: 520)
                .padding(16)
                .id(e.id)
                .transition(.asymmetric(
                    insertion: .move(edge: .bottom).combined(with: .opacity),
                    removal: .opacity.combined(with: .scale(scale: 0.95))
                ))
            }
        }
        .overlay(alignment: .top) {
            if let since = model.offlineSince {
                OfflineBadge(since: since).padding(.top, 8)
            }
        }
        .navigationTitle("Mapa")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
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
        .sensoryFeedback(.selection, trigger: selected)
    }
}
