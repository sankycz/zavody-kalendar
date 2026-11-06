import SwiftUI

/// Navigation to a race detail. `source` tells the zoom transition which card it grows from.
struct EventRoute: Hashable {
    let id: String
    var source: String = "list"
}

struct FavoriteButton: View {
    let event: RaceEvent
    @Environment(AppModel.self) private var model

    var body: some View {
        let on = model.isFavorite(event.id)
        Button {
            withAnimation(Theme.spring) { model.toggleFavorite(event) }
        } label: {
            Image(systemName: on ? "star.fill" : "star")
                .font(.title3.weight(.semibold))
                .foregroundStyle(on ? Theme.gold : Color.secondary)
                .contentTransition(.symbolEffect(.replace))
                .symbolEffect(.bounce, value: on)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .sensoryFeedback(on ? .success : .impact(weight: .light), trigger: on)
        .accessibilityLabel(on ? "Odebrat z oblíbených" : "Přidat do oblíbených")
    }
}

/// Day, month and weekday in the discipline's colour.
struct DateBlock: View {
    let from: String
    let to: String?
    let color: Color

    var body: some View {
        VStack(spacing: 0) {
            Text(Fmt.monthShort(from).uppercased())
                .font(.caption2.weight(.heavy))
                .tracking(0.8)
                .foregroundStyle(color)
            Text(Fmt.dayNumber(from))
                .font(.system(size: 28, weight: .heavy, design: .rounded))
                .monospacedDigit()
            Text(Fmt.weekdays(from, to))
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
        }
        .frame(width: 60)
        .padding(.vertical, 8)
        .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(color.opacity(0.25)))
    }
}

struct EventCard: View {
    let event: RaceEvent
    var distanceKm: Double?
    @Environment(OfflineStore.self) private var offline

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            DateBlock(from: event.dateFrom, to: event.dateTo, color: event.discipline.color)
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top, spacing: 4) {
                    Text(event.name)
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .strikethrough(event.isCancelled)
                        .multilineTextAlignment(.leading)
                        .lineLimit(3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 2)
                    FavoriteButton(event: event)
                        .padding(.top, -10)
                        .padding(.trailing, -10)
                }
                if let km = distanceKm {
                    Label("\(Distance.label(km)) · \(event.locationName ?? event.region ?? "")", systemImage: "location.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.accent)
                        .lineLimit(1)
                } else if let place = event.placeLine {
                    Label(place, systemImage: "mappin.and.ellipse")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                HStack(spacing: 6) {
                    DisciplinePill(discipline: event.discipline)
                    LevelPill(level: event.level)
                    if offline.isSaved(event.id) {
                        Image(systemName: "arrow.down.circle.fill")
                            .font(.subheadline)
                            .foregroundStyle(.green)
                            .transition(.scale.combined(with: .opacity))
                            .accessibilityLabel("Uloženo pro offline")
                    }
                }
                statusLine
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(tint: event.discipline.color)
        .opacity(event.isCancelled ? 0.72 : 1)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var statusLine: some View {
        if event.isCancelled {
            Label(event.flag == .cancelled ? OrganizerFlag.cancelled.label : "Zrušeno", systemImage: "xmark.octagon.fill")
                .font(.caption.weight(.bold))
                .foregroundStyle(.red)
        } else if let flag = event.flag {
            Label(flag.label, systemImage: "exclamationmark.triangle.fill")
                .font(.caption.weight(.bold))
                .foregroundStyle(.orange)
        } else if let rel = Fmt.relativeDay(event.dateFrom, event.dateTo) {
            Text(rel.uppercased())
                .font(.caption2.weight(.heavy))
                .tracking(0.6)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .foregroundStyle(.white)
                .background(Theme.racing, in: Capsule())
        }
    }
}

/// Big card on top of the list: the nearest favorite (else the nearest race) with a countdown.
struct NextRaceCard: View {
    let event: RaceEvent
    let isFavorite: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shine = false

    var body: some View {
        let days = Fmt.daysUntil(event.dateFrom)
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text(isFavorite ? "TVŮJ DALŠÍ ZÁVOD" : "NEJBLIŽŠÍ ZÁVOD")
                    .font(.caption.weight(.heavy))
                    .tracking(1.2)
                    .foregroundStyle(.white.opacity(0.8))
                Text(event.name)
                    .font(.system(.title2, design: .rounded, weight: .heavy))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                Label("\(Fmt.dateRange(event.dateFrom, event.dateTo)) · \(event.locationName ?? event.region ?? "")", systemImage: "calendar")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white.opacity(0.9))
                    .lineLimit(1)
                DisciplinePill(discipline: event.discipline, onColor: true)
            }
            Spacer(minLength: 0)
            VStack(spacing: 0) {
                Text(days > 0 ? "\(days)" : "🏁")
                    .font(.system(size: 46, weight: .black, design: .rounded))
                    .monospacedDigit()
                    .contentTransition(.numericText(countsDown: true))
                Text(days > 0 ? (days == 1 ? "den" : days < 5 ? "dny" : "dní") : (days == 0 ? "dnes" : "jede se"))
                    .font(.caption.weight(.bold))
            }
            .foregroundStyle(.white)
            .frame(minWidth: 70)
        }
        .padding(18)
        .background {
            ZStack {
                LinearGradient(colors: [event.discipline.color, Theme.accent, Theme.accent2], startPoint: .topLeading, endPoint: .bottomTrailing)
                CheckeredPattern().opacity(0.09)
                // Light sweeping across the card once it appears.
                LinearGradient(colors: [.clear, .white.opacity(0.35), .clear], startPoint: .leading, endPoint: .trailing)
                    .frame(width: 120)
                    .rotationEffect(.degrees(18))
                    .offset(x: shine ? 420 : -420)
                    .blendMode(.plusLighter)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .shadow(color: Theme.accent.opacity(0.35), radius: 22, x: 0, y: 12)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.4).delay(0.5)) { shine = true }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Finish-flag checkers for backgrounds.
struct CheckeredPattern: View {
    var square: CGFloat = 14
    var body: some View {
        Canvas { ctx, size in
            let cols = Int(size.width / square) + 1
            let rows = Int(size.height / square) + 1
            for r in 0..<rows {
                for c in 0..<cols where (r + c) % 2 == 0 {
                    ctx.fill(Path(CGRect(x: CGFloat(c) * square, y: CGFloat(r) * square, width: square, height: square)), with: .color(.white))
                }
            }
        }
        .allowsHitTesting(false)
    }
}
