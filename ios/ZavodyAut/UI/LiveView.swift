import SwiftUI

/// Pulsing "on air" dot.
struct LiveDot: View {
    var color: Color = .white
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var ping = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 10, height: 10)
            .background {
                Circle()
                    .fill(color.opacity(0.6))
                    .scaleEffect(ping ? 2.6 : 1)
                    .opacity(ping ? 0 : 1)
            }
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { ping = true }
            }
            .accessibilityHidden(true)
    }
}

/// Big button in the detail: "Živě ze závodu" with what the page has.
struct LiveButton: View {
    let mode: LiveMode
    let parts: [String]

    var body: some View {
        HStack(spacing: 14) {
            LiveDot()
            VStack(alignment: .leading, spacing: 2) {
                Text(mode == .live ? "Živě ze závodu" : "Zítra se jede")
                    .font(.system(.title3, design: .rounded, weight: .heavy))
                Text(parts.joined(separator: " · ").capitalizedFirst)
                    .font(.subheadline.weight(.medium))
                    .opacity(0.9)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.headline.weight(.bold))
        }
        .foregroundStyle(.white)
        .padding(18)
        .background(Theme.racing, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: Theme.accent.opacity(0.45), radius: 18, x: 0, y: 10)
    }
}

/// "Živě ze závodu": weather and rain radar at the place, where to follow results and the stream.
/// Results stay on the organizer's / series' site, the app only links there.
struct LiveView: View {
    let event: EventDetail
    let mode: LiveMode

    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var forecast: Fetched<Forecast>?
    @State private var forecastFailed = false
    @State private var radar: RadarMaps?
    @State private var radarFailed = false
    @State private var frame = 0
    @State private var playing = false
    @State private var appeared = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header.reveal(0, visible: appeared)
                if let lat = event.lat, let lng = event.lng {
                    LiveSection(title: mode == .live ? "Počasí teď" : "Počasí na zítra", symbol: "cloud.sun.fill") {
                        weather
                    }
                    .reveal(1, visible: appeared)
                    LiveSection(title: "Dešťový radar", symbol: "cloud.rain.fill") {
                        radarSection(lat: lat, lng: lng)
                    }
                    .reveal(2, visible: appeared)
                }
                if let results = event.live?.results, !results.isEmpty {
                    LiveSection(title: "Výsledky a live timing", symbol: "stopwatch.fill") {
                        links(results)
                    }
                    .reveal(3, visible: appeared)
                }
                if let streams = event.live?.streams, !streams.isEmpty {
                    LiveSection(title: "Přenos", symbol: "play.rectangle.fill") {
                        links(streams)
                    }
                    .reveal(4, visible: appeared)
                }
            }
            .padding(16)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .background { RacingBackground() }
        .navigationTitle(mode == .live ? "Živě" : "Zítra")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadForecast() }
        .task { await loadRadar() }
        .task(id: playing) { await play() }
        .onAppear { appeared = true }
        .sensoryFeedback(.selection, trigger: playing)
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                LiveDot()
                Text(mode == .live ? "PRÁVĚ SE JEDE" : "ZÍTRA SE JEDE")
                    .font(.caption.weight(.heavy))
                    .tracking(1.2)
            }
            Text(event.name)
                .font(.system(.title, design: .rounded, weight: .heavy))
                .fixedSize(horizontal: false, vertical: true)
            Text([Fmt.longDateRange(event.dateFrom, event.dateTo), event.venue ?? event.locationName].compactMap { $0 }.joined(separator: " · "))
                .font(.subheadline.weight(.medium))
                .opacity(0.9)
        }
        .foregroundStyle(.white)
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack(alignment: .trailing) {
                LinearGradient(colors: [Theme.accent, Theme.accent2], startPoint: .topLeading, endPoint: .bottomTrailing)
                CheckeredPattern(square: 12).frame(width: 90).opacity(0.14)
                    .mask(LinearGradient(colors: [.black, .clear], startPoint: .trailing, endPoint: .leading))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
    }

    // MARK: Weather

    @ViewBuilder private var weather: some View {
        if let forecast {
            let f = forecast.value
            let hours = f.hours(mode, raceDay: event.dateFrom)
            let wet = hours.filter(\.wet)
            VStack(alignment: .leading, spacing: 14) {
                if mode == .live {
                    let look = WeatherLook(f.current.weatherCode)
                    HStack(spacing: 16) {
                        Image(systemName: look.symbol)
                            .symbolRenderingMode(.multicolor)
                            .font(.system(size: 52))
                            .symbolEffect(.breathe, options: .repeat(.periodic(delay: 2)), isActive: !reduceMotion)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(Int(f.current.temperature.rounded())) °C")
                                .font(.system(size: 38, weight: .heavy, design: .rounded))
                                .monospacedDigit()
                                .contentTransition(.numericText())
                            Text("\(look.text) · vítr \(Int(f.current.windSpeed.rounded())) km/h, nárazy \(Int(f.current.windGusts.rounded())) km/h")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                (Text(mode == .eve ? "Zítra během dne: " : "Dalších 12 hodin: ")
                    + Text(wet.first.map { "déšť možný od \($0.time.dropFirst(11).prefix(5))" } ?? "bez deště")
                        .foregroundStyle(wet.isEmpty ? Color.green : Color.blue))
                    .font(.subheadline.weight(.semibold))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(hours.enumerated()), id: \.element.id) { i, h in
                            HourTile(hour: h, index: i, visible: appeared)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .scrollClipDisabled()
                Text(forecastNote(f))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        } else if forecastFailed {
            Text("Předpověď se nepodařilo načíst.").font(.subheadline).foregroundStyle(.secondary)
        } else {
            RoundedRectangle(cornerRadius: 14).fill(.secondary.opacity(0.12)).frame(height: 120)
                .overlay(ProgressView())
        }
    }

    private func forecastNote(_ f: Forecast) -> String {
        var note = "Předpověď pro \(event.locationName ?? "místo závodu"), aktualizováno \(f.current.time.dropFirst(11).prefix(5)). Data Open-Meteo.com (CC BY 4.0)."
        if let saved = forecast?.savedAt { note = "Bez signálu, uloženo \(Fmt.formatTimestamp(saved)). " + note }
        return note
    }

    private func loadForecast() async {
        guard let lat = event.lat, let lng = event.lng else { return }
        do {
            let f = try await API.shared.external(Forecast.url(lat: lat, lng: lng), key: Forecast.key(event.id), as: Forecast.self)
            withAnimation(Theme.spring) { forecast = f }
        } catch {
            forecastFailed = true
        }
    }

    // MARK: Radar

    @ViewBuilder private func radarSection(lat: Double, lng: Double) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            RadarMapView(center: .init(latitude: lat, longitude: lng), maps: radar, frame: frame)
                .frame(height: 300)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            if let radar, let current = radar.radar.past[safe: frame] {
                HStack(spacing: 12) {
                    Button {
                        playing.toggle()
                    } label: {
                        Image(systemName: playing ? "pause.fill" : "play.fill")
                            .contentTransition(.symbolEffect(.replace))
                            .frame(width: 44, height: 44)
                            .background(.regularMaterial, in: Circle())
                    }
                    .buttonStyle(PressStyle())
                    .accessibilityLabel(playing ? "Zastavit animaci radaru" : "Přehrát poslední dvě hodiny radaru")
                    VStack(alignment: .leading, spacing: 4) {
                        Slider(
                            value: Binding(get: { Double(frame) }, set: { frame = Int($0.rounded()) }),
                            in: 0...Double(max(radar.radar.past.count - 1, 1)),
                            step: 1
                        )
                        .tint(Theme.accent)
                        HStack {
                            Text(Self.clock(current.time)).monospacedDigit().contentTransition(.numericText())
                            if frame == radar.radar.past.count - 1 { Text("poslední snímek").foregroundStyle(.secondary) }
                            Spacer()
                            Text("RainViewer").foregroundStyle(.secondary)
                        }
                        .font(.caption.weight(.semibold))
                    }
                }
            } else {
                Text(radarFailed ? "Radar se nepodařilo načíst." : "Načítám radar…")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func loadRadar() async {
        do {
            let maps = try await API.shared.external(RadarMaps.url, key: "radar-maps", as: RadarMaps.self).value
            guard !maps.radar.past.isEmpty else { radarFailed = true; return }
            radar = maps
            frame = maps.radar.past.count - 1
        } catch {
            radarFailed = true
        }
    }

    /// Two hours in 10-minute frames, 0.7 s each; loads a frame only when it's shown.
    private func play() async {
        guard playing, let n = radar?.radar.past.count, n > 1 else { return }
        while playing && !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(700))
            guard playing, !Task.isCancelled else { return }
            frame = (frame + 1) % n
        }
    }

    private static func clock(_ unix: Int) -> String {
        let c = Fmt.calendar.dateComponents([.hour, .minute], from: Date(timeIntervalSince1970: TimeInterval(unix)))
        return String(format: "%d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    // MARK: Links

    private func links(_ items: [LiveLink]) -> some View {
        VStack(spacing: 8) {
            ForEach(items, id: \.url) { l in
                if let url = URL(string: l.url) {
                    Button { openURL(url) } label: {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(l.label).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                                Text(url.host()?.replacingOccurrences(of: "www.", with: "") ?? l.url)
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if l.from == "organizer" {
                                Text("OD POŘADATELE")
                                    .font(.caption2.weight(.heavy))
                                    .padding(.horizontal, 7).padding(.vertical, 3)
                                    .background(Color.green.opacity(0.15), in: Capsule())
                                    .foregroundStyle(.green)
                            }
                            Image(systemName: "arrow.up.right").font(.caption.weight(.bold)).foregroundStyle(.tertiary)
                        }
                        .padding(12)
                        .background(.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PressStyle())
                }
            }
        }
    }
}

/// One hour of the forecast; the rain bar grows in when the page appears.
private struct HourTile: View {
    let hour: Forecast.Hour
    let index: Int
    let visible: Bool

    var body: some View {
        let look = WeatherLook(hour.code)
        VStack(spacing: 6) {
            Text("\(hour.hour) h").font(.caption2.weight(.semibold)).foregroundStyle(.secondary).monospacedDigit()
            Image(systemName: look.symbol)
                .symbolRenderingMode(.multicolor)
                .font(.title3)
                .frame(height: 26)
                .accessibilityLabel(look.text)
            Text("\(Int(hour.temp.rounded()))°").font(.subheadline.weight(.bold)).monospacedDigit()
            ZStack(alignment: .bottom) {
                Capsule().fill(.secondary.opacity(0.15))
                Capsule()
                    .fill(hour.wet ? Color.blue : Color.blue.opacity(0.45))
                    .frame(height: visible ? max(3, 34 * Double(hour.chance ?? 0) / 100) : 0)
                    .animation(.spring(response: 0.6, dampingFraction: 0.75).delay(0.3 + Double(index) * 0.04), value: visible)
            }
            .frame(width: 6, height: 34)
            Text(hour.chance.map { "\($0) %" } ?? "–")
                .font(.caption2.weight(hour.wet ? .bold : .regular))
                .foregroundStyle(hour.wet ? Color.blue : Color.secondary)
                .monospacedDigit()
        }
        .frame(width: 56)
        .padding(.vertical, 10)
        .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct LiveSection<Content: View>: View {
    let title: String
    let symbol: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title.uppercased(), systemImage: symbol)
                .font(.caption.weight(.heavy))
                .tracking(1)
                .foregroundStyle(.secondary)
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard()
    }
}

extension String {
    /// "počasí a radar" → "Počasí a radar"
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
