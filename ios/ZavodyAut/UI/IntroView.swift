import SwiftUI

/// Start-lights intro on launch: the road draws itself, the flag drops in, five pairs of red
/// lights come on one by one with a tick under the finger, go out — lights out, away we go —
/// with a heavy haptic and the logo pulses. A tap skips it. Reduce Motion: only the logo.
struct IntroView: View {
    var onFinish: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var road: CGFloat = 0
    @State private var flag = false
    @State private var title = false
    @State private var lit = 0
    @State private var lightsOut = false
    @State private var pulse = false
    @State private var tick = 0
    @State private var go = 0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            RadialGradient(
                colors: [Theme.accent.opacity(lightsOut ? 0.55 : Double(lit) * 0.07), .clear],
                center: .top, startRadius: 0, endRadius: 520
            )
            .ignoresSafeArea()

            VStack(spacing: 30) {
                if !reduceMotion {
                    gantry
                        .opacity(lightsOut ? 0.35 : 1)
                        .scaleEffect(lightsOut ? 0.94 : 1)
                }
                VStack(spacing: 16) {
                    LogoMark(road: road, flag: flag)
                        .frame(width: 104, height: 104)
                        .shadow(color: Theme.accent.opacity(pulse ? 0.8 : 0.35), radius: pulse ? 36 : 14)
                        .scaleEffect(pulse ? 1.1 : 1)
                    VStack(spacing: 6) {
                        (Text("Závody aut ") + Text("v Česku").foregroundStyle(Theme.racing))
                            .font(.system(size: 34, weight: .heavy, design: .rounded))
                            .foregroundStyle(.white)
                        Text("Kalendář automobilových závodů v Česku")
                            .font(.callout)
                            .foregroundStyle(.white.opacity(0.85))
                        Text("Rally · vrchy · okruhy · autokros · slalom")
                            .font(.footnote)
                            .foregroundStyle(.white.opacity(0.55))
                    }
                    .multilineTextAlignment(.center)
                    .opacity(title ? 1 : 0)
                    .offset(y: title ? 0 : 16)
                    .blur(radius: title ? 0 : 6)
                }
                Text("designed by JS Visuals")
                    .font(.caption2)
                    .tracking(0.6)
                    .foregroundStyle(.white.opacity(0.4))
                    .opacity(title ? 1 : 0)
            }
            .padding(24)

            VStack {
                Spacer()
                Text("Klepnutím přeskočíte")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.4))
                    .padding(.bottom, 20)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { onFinish() }
        .sensoryFeedback(.impact(weight: .light, intensity: 0.7), trigger: tick)
        .sensoryFeedback(.impact(weight: .heavy), trigger: go)
        .task { await run() }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Klepnutím přeskočíte")
    }

    private var gantry: some View {
        HStack(spacing: 10) {
            ForEach(0..<5, id: \.self) { i in
                VStack(spacing: 8) {
                    light(on: lit > i && !lightsOut)
                    light(on: lit > i && !lightsOut)
                }
                .padding(6)
                .background(Color.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
        .padding(12)
        .background(Color(white: 0.11), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.white.opacity(0.08)))
    }

    private func light(on: Bool) -> some View {
        Circle()
            .fill(on ? Color(hex: 0xFF2A2A) : Color(white: 0.17))
            .frame(width: 30, height: 30)
            .overlay(Circle().fill(.white.opacity(on ? 0.35 : 0)).frame(width: 9, height: 9).offset(x: -6, y: -6))
            .shadow(color: on ? Color.red.opacity(0.95) : .clear, radius: on ? 16 : 0)
            .scaleEffect(on ? 1.06 : 1)
    }

    private func pause(_ seconds: Double) async -> Bool {
        try? await Task.sleep(for: .seconds(seconds))
        return !Task.isCancelled
    }

    private func run() async {
        if reduceMotion {
            road = 1
            flag = true
            title = true
            if await pause(1.6) { onFinish() }
            return
        }
        withAnimation(.easeInOut(duration: 1.0)) { road = 1 }
        withAnimation(Theme.spring.delay(0.3)) { title = true }
        guard await pause(0.85) else { return }
        withAnimation(.spring(response: 0.45, dampingFraction: 0.55)) { flag = true }
        guard await pause(0.35) else { return }
        for i in 1...5 {
            withAnimation(.easeOut(duration: 0.12)) { lit = i }
            tick += 1
            guard await pause(0.42) else { return }
        }
        // The hold before lights out is never the same.
        guard await pause(Double.random(in: 0.3...0.8)) else { return }
        withAnimation(.easeIn(duration: 0.06)) { lightsOut = true }
        go += 1
        withAnimation(.spring(response: 0.32, dampingFraction: 0.45)) { pulse = true }
        guard await pause(0.25) else { return }
        withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) { pulse = false }
        if await pause(0.6) { onFinish() }
    }
}

#Preview {
    IntroView {}
}
