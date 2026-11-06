import CoreLocation
import MapLibre
import SwiftUI

/// Vector map with OpenFreeMap tiles (OpenStreetMap data, free, no key) like the web
/// (web/src/basemap.ts): Liberty in light mode, Dark natively in dark mode.
enum Basemap {
    static func style(_ scheme: ColorScheme) -> URL {
        URL(string: scheme == .dark ? "https://tiles.openfreemap.org/styles/dark" : "https://tiles.openfreemap.org/styles/liberty")!
    }

    /// Centre of Czechia.
    static let czechia = CLLocationCoordinate2D(latitude: 49.8, longitude: 15.47)

    /// Czechia's bounding box, so the whole country fits any screen width.
    static let czechiaBounds = MLNCoordinateBounds(
        sw: CLLocationCoordinate2D(latitude: 48.55, longitude: 12.09),
        ne: CLLocationCoordinate2D(latitude: 51.06, longitude: 18.86)
    )
}

/// The race the map highlights. `fly` moves the camera to it, a new `seq` repeats that for the same race.
struct MapFocus: Equatable {
    let id: String
    let fly: Bool
    let seq: Int
}

/// Races as coloured dots (discipline colour). Tapping a dot reports its race id.
struct RaceMapView: UIViewRepresentable {
    var events: [RaceEvent]
    /// false: a small preview in the detail, no gestures, centred on the one race.
    var interactive = true
    var focus: MapFocus?
    /// Raising it returns the camera to the whole of Czechia.
    var overview = 0
    /// Space kept free at the bottom for the UI floating over the map.
    var bottomInset: CGFloat = 0
    var onSelect: (String) -> Void = { _ in }

    @Environment(\.colorScheme) private var scheme

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MLNMapView {
        let map = MLNMapView(frame: .zero, styleURL: Basemap.style(scheme))
        map.delegate = context.coordinator
        map.isRotateEnabled = interactive
        map.isPitchEnabled = interactive
        map.setCenter(Basemap.czechia, zoomLevel: 5.9, animated: false)
        if interactive {
            // Never asks here: the prompt comes only from "Nejblíž mně".
            let status = CLLocationManager().authorizationStatus
            map.showsUserLocation = status == .authorizedWhenInUse || status == .authorizedAlways
            map.automaticallyAdjustsContentInset = false
            map.setContentInset(UIEdgeInsets(top: 0, left: 0, bottom: bottomInset, right: 0), animated: false, completionHandler: nil)
        } else {
            map.isUserInteractionEnabled = false
            map.logoView.isHidden = true
        }
        context.coordinator.sync(map)
        context.coordinator.applyFocus(map)
        return map
    }

    func updateUIView(_ map: MLNMapView, context: Context) {
        context.coordinator.parent = self
        let style = Basemap.style(scheme)
        if map.styleURL != style { map.styleURL = style }
        context.coordinator.sync(map)
        context.coordinator.applyFocus(map)
    }

    final class RaceAnnotation: MLNPointAnnotation {
        var eventID = ""
        var color: UIColor = .red
    }

    final class DotView: MLNAnnotationView {
        func configure(color: UIColor) {
            bounds = CGRect(x: 0, y: 0, width: 22, height: 22)
            backgroundColor = color
            layer.cornerRadius = 11
            layer.borderWidth = 3
            layer.borderColor = UIColor.white.cgColor
            layer.shadowColor = UIColor.black.cgColor
            layer.shadowOpacity = 0.3
            layer.shadowRadius = 4
            layer.shadowOffset = CGSize(width: 0, height: 2)
        }

        func setPicked(_ picked: Bool, animated: Bool) {
            let scale: CGAffineTransform = picked ? CGAffineTransform(scaleX: 1.55, y: 1.55) : .identity
            guard animated else { transform = scale; return }
            UIView.animate(withDuration: 0.4, delay: 0, usingSpringWithDamping: 0.5, initialSpringVelocity: 0.8) {
                self.transform = scale
            }
        }
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        var parent: RaceMapView
        private var shown: [String] = []
        private var fitted = false
        private var annotations: [String: RaceAnnotation] = [:]
        private var pickedID: String?
        private var lastSeq: Int?
        private var lastOverview = 0

        /// Tilted close-up like the stadium detail in Football Diary; close enough for 3D buildings (zoom 14+).
        private static let raceDistance: CLLocationDistance = 1500
        private static let racePitch: CGFloat = 60
        private static let raceHeading: CLLocationDirection = 340

        init(_ parent: RaceMapView) { self.parent = parent }

        func sync(_ map: MLNMapView) {
            let ids = parent.events.map(\.id)
            guard ids != shown else { return }
            shown = ids
            if let old = map.annotations, !old.isEmpty { map.removeAnnotations(old) }
            let annotations: [RaceAnnotation] = parent.events.compactMap { e in
                guard let lat = e.lat, let lng = e.lng else { return nil }
                let a = RaceAnnotation()
                a.coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
                a.title = e.name
                a.subtitle = Fmt.dateRange(e.dateFrom, e.dateTo)
                a.eventID = e.id
                a.color = UIColor(e.discipline.color)
                return a
            }
            self.annotations = Dictionary(annotations.map { ($0.eventID, $0) }, uniquingKeysWith: { first, _ in first })
            map.addAnnotations(annotations)
            if !parent.interactive, let first = annotations.first {
                map.setCenter(first.coordinate, zoomLevel: 9.5, animated: false)
            }
        }

        func applyFocus(_ map: MLNMapView) {
            if parent.overview != lastOverview {
                lastOverview = parent.overview
                showCzechia(map, duration: Self.reduceMotion ? 0 : 1)
            }
            guard let focus = parent.focus, focus.seq != lastSeq else { return }
            lastSeq = focus.seq
            pick(focus.id, on: map)
            guard focus.fly, let target = annotations[focus.id] else { return }
            let heading = map.direction == 0 ? Self.raceHeading : map.direction
            let camera = MLNMapCamera(lookingAtCenter: target.coordinate, acrossDistance: Self.raceDistance, pitch: Self.racePitch, heading: heading)
            if Self.reduceMotion {
                map.setCamera(camera, animated: false)
            } else {
                map.fly(to: camera, withDuration: 1.6, completionHandler: nil)
            }
        }

        private static var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }

        private func pick(_ id: String, on map: MLNMapView) {
            guard id != pickedID else { return }
            if let old = pickedID.flatMap({ annotations[$0] }) {
                (map.view(for: old) as? DotView)?.setPicked(false, animated: true)
            }
            pickedID = id
            if let new = annotations[id] {
                (map.view(for: new) as? DotView)?.setPicked(true, animated: true)
            }
        }

        private func showCzechia(_ map: MLNMapView, duration: TimeInterval) {
            let inset = UIEdgeInsets(top: 24, left: 24, bottom: 24, right: 24)
            // Fitted for the flat camera: the current one may be tilted over a race.
            let flat = map.camera
            flat.pitch = 0
            flat.heading = 0
            let camera = map.camera(flat, fitting: Basemap.czechiaBounds, edgePadding: inset)
            map.setCamera(camera, withDuration: duration, animationTimingFunction: nil)
        }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            guard parent.interactive else { return }
            add3DBuildings(to: style)
            // Once, when the map has its real size (not again on a light/dark style change).
            guard !fitted, mapView.bounds.width > 0 else { return }
            fitted = true
            showCzechia(mapView, duration: 0)
        }

        /// The Liberty style has them already, Dark does not (same as Football Diary).
        private func add3DBuildings(to style: MLNStyle) {
            guard style.layer(withIdentifier: "building-3d") == nil,
                  let tiles = style.source(withIdentifier: "openmaptiles") else { return }
            let layer = MLNFillExtrusionStyleLayer(identifier: "building-3d", source: tiles)
            layer.sourceLayerIdentifier = "building"
            layer.minimumZoomLevel = 14
            layer.fillExtrusionColor = NSExpression(forConstantValue: UIColor(red: 0.2, green: 0.22, blue: 0.26, alpha: 1))
            layer.fillExtrusionHeight = NSExpression(mglJSONObject: ["coalesce", ["get", "render_height"], 6])
            layer.fillExtrusionBase = NSExpression(mglJSONObject: ["coalesce", ["get", "render_min_height"], 0])
            layer.fillExtrusionOpacity = NSExpression(forConstantValue: 0.85)
            style.addLayer(layer)
        }

        func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
            guard let a = annotation as? RaceAnnotation else { return nil }
            let reuse = "race"
            let view = (mapView.dequeueReusableAnnotationView(withIdentifier: reuse) as? DotView) ?? DotView(reuseIdentifier: reuse)
            view.configure(color: a.color)
            view.setPicked(a.eventID == pickedID, animated: false)
            return view
        }

        func mapView(_ mapView: MLNMapView, annotationCanShowCallout annotation: MLNAnnotation) -> Bool { false }

        func mapView(_ mapView: MLNMapView, didSelect annotation: MLNAnnotation) {
            guard let a = annotation as? RaceAnnotation else { return }
            // The highlight is ours; deselecting lets the same dot be tapped again.
            mapView.deselectAnnotation(a, animated: false)
            parent.onSelect(a.eventID)
        }
    }
}
