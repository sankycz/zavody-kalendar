import SwiftUI

@main
struct ZavodyAutApp: App {
    @State private var model = AppModel()
    @State private var offline = OfflineStore()
    @State private var connectivity = Connectivity()
    @State private var location = LocationProvider()
    @State private var intro = true

    var body: some Scene {
        WindowGroup {
            ZStack {
                RootView()
                    .environment(model)
                    .environment(offline)
                    .environment(connectivity)
                    .environment(location)
                if intro {
                    IntroView {
                        withAnimation(.easeOut(duration: 0.5)) { intro = false }
                    }
                    .transition(.opacity.combined(with: .scale(scale: 1.06)))
                    .zIndex(1)
                }
            }
            .preferredColorScheme(model.theme.scheme)
        }
    }
}

enum AppTab: Hashable {
    case races, map, favorites
}

/// Tabs on iPhone; on iPad and Mac the same tabs turn into a sidebar.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(OfflineStore.self) private var offline
    @Environment(Connectivity.self) private var connectivity
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab: AppTab = .races
    @State private var racesPath = NavigationPath()

    var body: some View {
        TabView(selection: $tab) {
            Tab("Závody", systemImage: "flag.checkered", value: AppTab.races) {
                NavigationStack(path: $racesPath) { EventListView(mode: .all) }
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
        .task { await refresh(force: false) }
        .onOpenURL { url in open(url) }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { open(url) }
        }
        .onChange(of: scenePhase) { _, phase in
            // Back from the background: fresh data (statuses change on race day).
            if phase == .active { Task { await refresh(force: false) } }
        }
        .onChange(of: connectivity.online) { _, online in
            // Signal is back: fresh data and the weekend's races stored again.
            if online { Task { await refresh(force: true) } }
        }
    }

    /// A race link from the web (Universal Link) or the widget: its detail on the races tab.
    private func open(_ url: URL) {
        guard let route = EventRoute(url: url) else { return }
        tab = .races
        racesPath = NavigationPath()
        racesPath.append(route)
    }

    private func refresh(force: Bool) async {
        await model.load()
        guard connectivity.online, model.offlineSince == nil else { return }
        await offline.sync(from: model.events, favorites: Set(model.favorites.keys), force: force)
    }
}
