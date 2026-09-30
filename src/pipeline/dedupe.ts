import type { NormalizedEvent } from "./schema.ts";

/** ASCII slug: 'Český Krumlov' -> 'cesky-krumlov'. */
export function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** dedupe_key = normalized location + start date + discipline. */
export function dedupeKey(location: string, dateFrom: string, discipline: string): string {
  return `${slug(location)}|${dateFrom}|${discipline}`;
}

/** Place part of a dedupe_key: 'becov-nad-teplou|2026-09-04|vrch' -> 'becov-nad-teplou'. */
export function placeOf(key: string): string {
  return key.slice(0, key.indexOf("|"));
}

/**
 * Same municipality written shorter or longer: 'becov' ~ 'becov-nad-teplou',
 * 'namest' ~ 'namest-nad-oslavou'. Whole words only ('most' !~ 'mostek').
 */
export function samePlace(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
}

/** Of two names for one place, keep the more specific (longer) one. */
export function preferredLocation(a: string | null, b: string | null): string | null {
  if (!a || !b) return a ?? b;
  const [sa, sb] = [slug(a), slug(b)];
  if (!samePlace(sa, sb)) return null;
  return sb.length > sa.length ? b : a;
}

const MERGE_FIELDS = [
  "name",
  "date_to",
  "series",
  "level",
  "location_name",
  "region",
  "country",
  "organizer",
  "website_url",
  "description",
  "status",
] as const satisfies readonly (keyof NormalizedEvent)[];

export type MergeFields = Pick<NormalizedEvent, (typeof MERGE_FIELDS)[number]>;

/**
 * Merge an incoming event into an existing one.
 * - incomingWins (incoming source has equal or better priority): its non-null
 *   values overwrite, nulls keep the existing value.
 * - otherwise the existing values stay and the incoming one only fills gaps.
 */
export function mergeEvent<T extends MergeFields>(existing: T, incoming: MergeFields, incomingWins: boolean): T {
  const out = { ...existing };
  for (const f of MERGE_FIELDS) {
    const inc = incoming[f];
    if (inc == null) continue;
    if (incomingWins || existing[f] == null) (out as MergeFields)[f] = inc as never;
  }
  return out;
}

/**
 * Collapse duplicates within one extraction batch (the same race listed twice
 * in one source). First occurrence wins, later ones fill missing fields.
 */
export function dedupeBatch(events: NormalizedEvent[]): NormalizedEvent[] {
  const byKey = new Map<string, NormalizedEvent>();
  for (const e of events) {
    const prev = byKey.get(e.dedupe_key);
    byKey.set(e.dedupe_key, prev ? { ...mergeEvent(prev, e, false), raw_excerpt: prev.raw_excerpt } : e);
  }
  return [...byKey.values()];
}
