import SwiftUI

/// Moving colour behind the glass (the web's drifting orbs) as a slowly breathing mesh gradient.
/// Still with Reduce Motion.
struct RacingBackground: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 20.0, paused: reduceMotion)) { context in
            let t = Float(context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 10_000))
            MeshGradient(width: 3, height: 3, points: Self.points(reduceMotion ? 0 : t), colors: colors)
        }
        .background(base)
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }

    private var base: Color { scheme == .dark ? Color(hex: 0x06070B) : Color(hex: 0xEEF0F5) }

    private var colors: [Color] {
        let o = scheme == .dark ? 0.42 : 0.3
        return [
            Color(hex: 0xFF2D55, opacity: o), base, Color(hex: 0x3B82F6, opacity: o),
            base, base, Color(hex: 0x8B5CF6, opacity: o * 0.8),
            Color(hex: 0xFF8A00, opacity: o), base, base,
        ]
    }

    private static func points(_ t: Float) -> [SIMD2<Float>] {
        let a = 0.5 + 0.2 * sin(t * 0.11)
        let b = 0.5 + 0.2 * sin(t * 0.09 + 1)
        let cx = 0.5 + 0.18 * sin(t * 0.13 + 2)
        let cy = 0.5 + 0.18 * cos(t * 0.10 + 3)
        let d = 0.5 + 0.2 * sin(t * 0.12 + 4)
        let e = 0.5 + 0.2 * cos(t * 0.08 + 5)
        return [
            SIMD2(0, 0), SIMD2(a, 0), SIMD2(1, 0),
            SIMD2(0, b), SIMD2(cx, cy), SIMD2(1, d),
            SIMD2(0, 1), SIMD2(e, 1), SIMD2(1, 1),
        ]
    }
}
