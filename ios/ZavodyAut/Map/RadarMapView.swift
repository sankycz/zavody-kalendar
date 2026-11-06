import MapLibre
import SwiftUI

/// Rain radar around the race: the vector base map with RainViewer's frame on top.
/// A frame's layer is added the first time it is shown (the free API allows
/// 100 requests a minute), the others are hidden by opacity.
struct RadarMapView: UIViewRepresentable {
    let center: CLLocationCoordinate2D
    let maps: RadarMaps?
    let frame: Int

    @Environment(\.colorScheme) private var scheme

    private static let opacity = 0.75

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MLNMapView {
        let map = MLNMapView(frame: .zero, styleURL: Basemap.style(scheme))
        map.delegate = context.coordinator
        map.isRotateEnabled = false
        map.isPitchEnabled = false
        map.maximumZoomLevel = 11
        map.setCenter(center, zoomLevel: 7.3, animated: false)
        let pin = MLNPointAnnotation()
        pin.coordinate = center
        map.addAnnotation(pin)
        return map
    }

    func updateUIView(_ map: MLNMapView, context: Context) {
        context.coordinator.parent = self
        let style = Basemap.style(scheme)
        if map.styleURL != style { map.styleURL = style }
        context.coordinator.apply(map)
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        var parent: RadarMapView
        init(_ parent: RadarMapView) { self.parent = parent }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            apply(mapView)
        }

        func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
            let view = RaceMapView.DotView(reuseIdentifier: "radar-pin")
            view.configure(color: UIColor(Theme.accent))
            return view
        }

        /// Shows the current frame (adding its layer on first use) and hides the others.
        func apply(_ map: MLNMapView) {
            guard let style = map.style, let maps = parent.maps, let current = maps.radar.past[safe: parent.frame] else { return }
            let id = Self.layerID(current)
            if style.layer(withIdentifier: id) == nil {
                let source = style.source(withIdentifier: id) ?? MLNRasterTileSource(
                    identifier: id,
                    tileURLTemplates: [maps.tileURL(current)],
                    options: [.maximumZoomLevel: 7, .tileSize: 256]
                )
                if style.source(withIdentifier: id) == nil { style.addSource(source) }
                let layer = MLNRasterStyleLayer(identifier: id, source: source)
                layer.rasterFadeDuration = NSExpression(forConstantValue: 0)
                style.addLayer(layer)
            }
            for frame in maps.radar.past {
                guard let layer = style.layer(withIdentifier: Self.layerID(frame)) as? MLNRasterStyleLayer else { continue }
                layer.rasterOpacity = NSExpression(forConstantValue: frame == current ? RadarMapView.opacity : 0)
            }
        }

        private static func layerID(_ frame: RadarFrame) -> String { "radar-\(frame.time)" }
    }
}
