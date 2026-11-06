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
}

/// Races as coloured dots (discipline colour). Tapping a dot reports its race id.
struct RaceMapView: UIViewRepresentable {
    var events: [RaceEvent]
    /// false: a small preview in the detail, no gestures, centred on the one race.
    var interactive = true
    var onSelect: (String?) -> Void = { _ in }

    @Environment(\.colorScheme) private var scheme

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MLNMapView {
        let map = MLNMapView(frame: .zero, styleURL: Basemap.style(scheme))
        map.delegate = context.coordinator
        map.isRotateEnabled = false
        map.isPitchEnabled = false
        map.setCenter(Basemap.czechia, zoomLevel: 5.9, animated: false)
        if interactive {
            map.showsUserLocation = true
        } else {
            map.isUserInteractionEnabled = false
            map.logoView.isHidden = true
        }
        context.coordinator.sync(map)
        return map
    }

    func updateUIView(_ map: MLNMapView, context: Context) {
        context.coordinator.parent = self
        let style = Basemap.style(scheme)
        if map.styleURL != style { map.styleURL = style }
        context.coordinator.sync(map)
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

        override func setSelected(_ selected: Bool, animated: Bool) {
            super.setSelected(selected, animated: animated)
            UIView.animate(withDuration: 0.4, delay: 0, usingSpringWithDamping: 0.5, initialSpringVelocity: 0.8) {
                self.transform = selected ? CGAffineTransform(scaleX: 1.55, y: 1.55) : .identity
            }
        }
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        var parent: RaceMapView
        private var shown: [String] = []

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
            map.addAnnotations(annotations)
            if !parent.interactive, let first = annotations.first {
                map.setCenter(first.coordinate, zoomLevel: 9.5, animated: false)
            }
        }

        func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
            guard let a = annotation as? RaceAnnotation else { return nil }
            let reuse = "race"
            let view = (mapView.dequeueReusableAnnotationView(withIdentifier: reuse) as? DotView) ?? DotView(reuseIdentifier: reuse)
            view.configure(color: a.color)
            return view
        }

        func mapView(_ mapView: MLNMapView, annotationCanShowCallout annotation: MLNAnnotation) -> Bool { false }

        func mapView(_ mapView: MLNMapView, didSelect annotation: MLNAnnotation) {
            guard let a = annotation as? RaceAnnotation else { return }
            parent.onSelect(a.eventID)
        }

        func mapView(_ mapView: MLNMapView, didDeselect annotation: MLNAnnotation) {
            guard annotation is RaceAnnotation else { return }
            parent.onSelect(nil)
        }
    }
}
