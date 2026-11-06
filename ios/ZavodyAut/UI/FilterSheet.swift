import SwiftUI

/// Discipline, level and region. Changes apply live; the list and the map share them.
struct FilterSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private let grid = [GridItem(.adaptive(minimum: 150), spacing: 8)]

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    section("Disciplína") {
                        LazyVGrid(columns: grid, spacing: 8) {
                            ForEach(Discipline.allCases) { d in
                                ToggleChip(title: d.label, symbol: d.symbol, color: d.color, on: model.filters.disciplines.contains(d)) {
                                    model.filters.disciplines.toggle(d)
                                }
                            }
                        }
                    }
                    section("Úroveň") {
                        LazyVGrid(columns: grid, spacing: 8) {
                            ForEach(Level.allCases) { l in
                                ToggleChip(title: l.label, symbol: nil, color: l.color, on: model.filters.levels.contains(l)) {
                                    model.filters.levels.toggle(l)
                                }
                            }
                        }
                    }
                    section("Kraj") {
                        VStack(alignment: .leading, spacing: 12) {
                            Picker("Kraj", selection: $model.filters.region) {
                                Text("Všechny kraje").tag(String?.none)
                                ForEach(model.regions, id: \.self) { r in
                                    Text(r).tag(String?.some(r))
                                }
                            }
                            .pickerStyle(.menu)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .glassCard(radius: 14)

                            if let region = model.filters.region, region != model.homeRegion {
                                Button {
                                    model.homeRegion = region
                                } label: {
                                    Label("Uložit \(region) jako můj kraj", systemImage: "house")
                                }
                            }
                            if let home = model.homeRegion {
                                HStack {
                                    Label("Můj kraj: \(home)", systemImage: "house.fill")
                                        .foregroundStyle(.secondary)
                                    Spacer()
                                    Button("Zapomenout", role: .destructive) {
                                        model.homeRegion = nil
                                        model.filters.myRegionOnly = false
                                    }
                                }
                                .font(.subheadline)
                            }
                        }
                    }
                }
                .padding(20)
            }
            .navigationTitle("Filtry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Vše") {
                        withAnimation(Theme.spring) {
                            model.filters = Filters(myRegionOnly: model.filters.myRegionOnly)
                        }
                    }
                    .disabled(model.filters.activeCount == 0)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Hotovo") { dismiss() }
                }
            }
        }
        .sensoryFeedback(.selection, trigger: model.filters)
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased())
                .font(.caption.weight(.heavy))
                .tracking(1)
                .foregroundStyle(.secondary)
            content()
        }
    }
}

private struct ToggleChip: View {
    let title: String
    let symbol: String?
    let color: Color
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button {
            withAnimation(Theme.spring) { action() }
        } label: {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol) }
                Text(title).lineLimit(1).minimumScaleFactor(0.65)
                Spacer(minLength: 0)
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .contentTransition(.symbolEffect(.replace))
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .foregroundStyle(on ? Color.white : color)
            .background(on ? color : color.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(color.opacity(on ? 0 : 0.3)))
        }
        .buttonStyle(PressStyle())
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
