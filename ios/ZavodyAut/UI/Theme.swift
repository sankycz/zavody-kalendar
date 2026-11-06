import SwiftUI

enum Theme {
    static let accent = Color(hex: 0xE11D2E)
    static let accent2 = Color(hex: 0xFF7A18)
    static let ink = Color(hex: 0x0B0D14)
    static let gold = Color(hex: 0xFFC53D)
    static let racing = LinearGradient(colors: [accent, accent2], startPoint: .topLeading, endPoint: .bottomTrailing)

    /// One spring for the whole app: quick, a touch of bounce.
    static let spring = Animation.spring(response: 0.42, dampingFraction: 0.82)
}

/// Frosted glass: material, a light rim catching the light top-left, a soft tinted shadow.
struct GlassCard: ViewModifier {
    var radius: CGFloat = 22
    var tint: Color?
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background(.regularMaterial, in: shape)
            .overlay {
                shape.strokeBorder(
                    LinearGradient(
                        colors: [.white.opacity(scheme == .dark ? 0.22 : 0.85), .white.opacity(0.04), .white.opacity(scheme == .dark ? 0.1 : 0.45)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
            }
            .shadow(color: (tint ?? .black).opacity(scheme == .dark ? 0.35 : 0.12), radius: 18, x: 0, y: 10)
    }
}

extension View {
    func glassCard(radius: CGFloat = 22, tint: Color? = nil) -> some View {
        modifier(GlassCard(radius: radius, tint: tint))
    }

    /// Enter animation: rises and fades in, one after another by `index`.
    func reveal(_ index: Int, visible: Bool) -> some View {
        modifier(Reveal(index: index, visible: visible))
    }
}

private struct Reveal: ViewModifier {
    let index: Int
    let visible: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(visible ? 1 : 0)
            .offset(y: visible || reduceMotion ? 0 : 22)
            .scaleEffect(visible || reduceMotion ? 1 : 0.98)
            .animation(Theme.spring.delay(reduceMotion ? 0 : Double(min(index, 10)) * 0.05), value: visible)
    }
}

/// A press gives way under the finger.
struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .brightness(configuration.isPressed ? -0.02 : 0)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// Tinted capsule: discipline or level.
struct Pill: View {
    let text: String
    var symbol: String?
    let color: Color
    var onColor = false

    var body: some View {
        HStack(spacing: 4) {
            if let symbol { Image(systemName: symbol).imageScale(.small) }
            Text(text)
        }
        .font(.caption.weight(.semibold))
        .lineLimit(1)
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .foregroundStyle(onColor ? Color.white : color)
        .background(onColor ? Color.white.opacity(0.2) : color.opacity(0.14), in: Capsule())
        .overlay(Capsule().strokeBorder(onColor ? Color.white.opacity(0.25) : color.opacity(0.3), lineWidth: 1))
    }
}

struct DisciplinePill: View {
    let discipline: Discipline
    var onColor = false
    var body: some View {
        Pill(text: discipline.label, symbol: discipline.symbol, color: discipline.color, onColor: onColor)
    }
}

struct LevelPill: View {
    let level: Level
    var onColor = false
    var body: some View {
        Pill(text: level.label, color: level.color, onColor: onColor)
    }
}

/// "Bez signálu · uložená data z …"
struct OfflineBadge: View {
    let since: Date
    var body: some View {
        Label("Bez signálu · uložená data z \(Fmt.formatTimestamp(since))", systemImage: "wifi.slash")
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(.orange.opacity(0.18), in: Capsule())
            .foregroundStyle(.orange)
    }
}
