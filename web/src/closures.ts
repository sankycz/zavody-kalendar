// Road closures: rally stages and hill climbs run on public roads closed for hours.
// Navigation apps don't know, so the detail warns and points to the organizer's documents.
import type { Discipline, EventDetail, EventLink, LinkKind } from "../../src/shared/types.ts";

/** Disciplines raced on public roads closed for the race. */
const ON_CLOSED_ROADS: ReadonlySet<Discipline> = new Set(["rally", "rallysprint", "vrch"]);

/** Where an organizer typically lists closure times, best first. */
const CLOSURE_DOCS: readonly LinkKind[] = ["divaci", "mapa", "harmonogram", "propozice"];

/** Warn only for upcoming races on closed roads. */
export function closesRoads(e: Pick<EventDetail, "discipline" | "status" | "organizer_flag">): boolean {
  if (e.status !== "planned" || e.organizer_flag === "cancelled" || e.organizer_flag === "postponed") return false;
  return ON_CLOSED_ROADS.has(e.discipline);
}

/** The organizer's document most likely to show the closed roads and times, if any. */
export function closureDoc(links: readonly EventLink[]): EventLink | null {
  for (const kind of CLOSURE_DOCS) {
    const l = links.find((x) => x.kind === kind);
    if (l) return l;
  }
  return null;
}
