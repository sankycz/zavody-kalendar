import SwiftUI

@main
struct ZavodyAutApp: App {
    @State private var model = AppModel()
    @State private var intro = true

    var body: some Scene {
        WindowGroup {
            ZStack {
                RootView()
                    .environment(model)
                if intro {
                    IntroView {
                        withAnimation(.easeOut(duration: 0.5)) { intro = false }
                    }
                    .transition(.opacity.combined(with: .scale(scale: 1.06)))
                    .zIndex(1)
                }
            }
            .task { await model.load() }
        }
    }
}

enum AppTab: Hashable {
    case races, map, favorites
}

/// Tabs on iPhone; on iPad and Mac the same tabs turn into a sidebar.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab: AppTab = .races

    var body: some View {
        TabView(selection: $tab) {
            Tab("Závody", systemImage: "flag.checkered", value: AppTab.races) {
                NavigationStack { EventListView(mode: .all) }
            }
            Tab("Mapa", systemImage: "map.fill", value: AppTab.map) {
                NavigationStack { MapScreen() }
            }
            Tab("Oblíbené", systemImage: "star.fill", value: AppTab.favorites) {
                NavigationStack { EventListView(mode: .favorites) }
            }
            .badge(model.favorites.count)
        }
        .tabViewStyle(.sidebarAdaptable)
        .tint(Theme.accent)
        .sensoryFeedback(.selection, trigger: tab)
        .onChange(of: scenePhase) { _, phase in
            // Back from the background with signal: fresh data (statuses change on race day).
            if phase == .active { Task { await model.load() } }
        }
    }
}
