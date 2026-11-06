import CoreLocation
import Foundation
import Observation

/// The device's position for "Nejblíž mně", asked for only when the user wants it.
/// It stays in the device (nothing is sent anywhere), accuracy about a kilometre is enough.
@MainActor
@Observable
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    private(set) var location: CLLocation?
    private(set) var denied = false
    private(set) var locating = false
    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    func request() {
        switch manager.authorizationStatus {
        case .notDetermined:
            locating = true
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            denied = true
        default:
            locating = true
            manager.requestLocation()
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            switch status {
            case .authorizedWhenInUse, .authorizedAlways:
                self.denied = false
                if self.locating { self.manager.requestLocation() }
            case .denied, .restricted:
                self.denied = true
                self.locating = false
            default:
                break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let last = locations.last
        Task { @MainActor in
            self.location = last
            self.locating = false
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.locating = false }
    }
}

extension RaceEvent {
    /// Straight-line distance in km from a position, nil without a point.
    func distanceKm(from location: CLLocation?) -> Double? {
        guard let location, let lat, let lng else { return nil }
        return location.distance(from: CLLocation(latitude: lat, longitude: lng)) / 1000
    }
}

enum Distance {
    /// "800 m", "12 km", "124 km"
    static func label(_ km: Double) -> String {
        km < 1 ? "\(Int((km * 1000 / 100).rounded()) * 100) m" : "\(Int(km.rounded())) km"
    }
}
