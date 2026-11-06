import SwiftUI

// The app's logo "Zatáčka" (web/src/logo.ts): a winding special stage with the finish flag
// on a dark background. Drawn natively so the intro can draw the road and drop the flag in.

/// The road: M120 440 C120 330 392 330 392 250 S120 170 160 92 in a 512 box.
struct RoadShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 512
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
        var path = Path()
        path.move(to: p(120, 440))
        path.addCurve(to: p(392, 250), control1: p(120, 330), control2: p(392, 330))
        path.addCurve(to: p(160, 92), control1: p(392, 170), control2: p(120, 170))
        return path
    }
}

/// The checkered flag on its pole, at (300, 54) in the 512 box.
private struct FlagView: View {
    var body: some View {
        Canvas { ctx, size in
            let s = size.width / 512
            func r(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect {
                CGRect(x: (300 + x) * s, y: (54 + y) * s, width: w * s, height: h * s)
            }
            ctx.fill(Path(roundedRect: r(0, 0, 10, 120), cornerRadius: 5 * s), with: .color(.white))
            ctx.fill(Path(roundedRect: r(10, 4, 96, 64), cornerRadius: 6 * s), with: .color(.white))
            let squares: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
                (10, 4, 24, 21), (58, 4, 24, 21), (34, 25, 24, 22), (82, 25, 24, 22), (10, 47, 24, 21), (58, 47, 24, 21),
            ]
            for (x, y, w, h) in squares {
                ctx.fill(Path(r(x, y, w, h)), with: .color(Theme.ink))
            }
        }
    }
}

struct LogoMark: View {
    /// How much of the road is drawn (0…1).
    var road: CGFloat = 1
    var flag = true
    /// Corner radius as a fraction of the side.
    var corner: CGFloat = 0.225

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            let s = side / 512
            ZStack {
                RoundedRectangle(cornerRadius: side * corner, style: .continuous).fill(Theme.ink)
                ZStack {
                    RoadShape()
                        .trim(from: 0, to: road)
                        .stroke(Theme.racing, style: StrokeStyle(lineWidth: 78 * s, lineCap: .round))
                    RoadShape()
                        .trim(from: 0, to: road)
                        .stroke(Color.white.opacity(0.9), style: StrokeStyle(lineWidth: 8 * s, lineCap: .round, dash: [26 * s, 30 * s]))
                    FlagView()
                        .scaleEffect(flag ? 1 : 0.1, anchor: UnitPoint(x: 305.0 / 512, y: 174.0 / 512))
                        .opacity(flag ? 1 : 0)
                }
                .frame(width: side, height: side)
                .scaleEffect(0.8, anchor: UnitPoint(x: 0.5, y: 262.0 / 512))
            }
            .frame(width: side, height: side)
            .clipShape(RoundedRectangle(cornerRadius: side * corner, style: .continuous))
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }
}
