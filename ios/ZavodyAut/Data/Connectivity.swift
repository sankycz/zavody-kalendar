import Foundation
import Network
import Observation

/// Whether the device has a usable network path right now (NWPathMonitor).
@MainActor
@Observable
final class Connectivity {
    private(set) var online = true
    private let monitor = NWPathMonitor()

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in self?.online = online }
        }
        monitor.start(queue: DispatchQueue(label: "cz.zavodyaut.connectivity"))
    }
}
