import EventKit
import EventKitUI
import SwiftUI

/// A prefilled all-day event for the system "New Event" sheet. Adding through EventKitUI
/// needs no calendar permission: the user confirms the event in the system's own sheet.
struct CalendarDraft: Identifiable {
    let id = UUID()
    let title: String
    let start: Date
    let end: Date
    let location: String?
    let url: URL
    let notes: String?

    init?(_ e: EventDetail) {
        guard let start = Fmt.date(e.dateFrom) else { return nil }
        title = e.name
        self.start = start
        end = e.dateTo.flatMap(Fmt.date) ?? start
        location = [e.venue, e.locationName].compactMap { $0 }.first
        url = API.pageURL(e.id)
        notes = [e.series, e.organizer.map { "Pořadatel: \($0)" }, e.websiteUrl].compactMap { $0 }.joined(separator: "\n")
    }
}

struct CalendarEditor: UIViewControllerRepresentable {
    let draft: CalendarDraft
    let onDone: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        event.title = draft.title
        // The time zone must come before isAllDay: setting it later turns the all-day flag off.
        event.timeZone = Fmt.prague
        event.startDate = draft.start
        event.endDate = draft.end
        event.isAllDay = true
        event.location = draft.location
        event.url = draft.url
        event.notes = draft.notes

        let controller = EKEventEditViewController()
        controller.eventStore = store
        controller.event = event
        controller.editViewDelegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: EKEventEditViewController, context: Context) {}

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        let onDone: () -> Void
        init(onDone: @escaping () -> Void) { self.onDone = onDone }

        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            onDone()
        }
    }
}
