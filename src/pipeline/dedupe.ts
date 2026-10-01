import type { NormalizedEvent } from "./schema.ts";

/** Lowercase ASCII without diacritics (same as normalize.ts fold, kept here to avoid an import cycle). */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

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
    if (!prev) {
      byKey.set(e.dedupe_key, e);
      continue;
    }
    const links = [...prev.links, ...e.links.filter((l) => !prev.links.some((p) => p.url === l.url))];
    byKey.set(e.dedupe_key, { ...mergeEvent(prev, e, false), raw_excerpt: prev.raw_excerpt, links });
  }
  return [...byKey.values()];
}

/** Words that say nothing about which race it is. */
const STOP = new Set(["a", "v", "ve", "na", "u", "do", "z", "ze", "of", "the", "cz", "rocnik", "zavod", "zavody"]);

/** Distinctive words of a race name: no diacritics, years, ordinals (XI., 11.) or stop words. */
export function nameWords(name: string): Set<string> {
  return new Set(
    fold(name)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !/^[ivxlc]+$/.test(w) && !STOP.has(w)),
  );
}

/**
 * Same race named in two places: most words of the shorter name appear in the
 * other one ('Podbrdské setkání Legend' ~ 'XI. Podbrdské setkání legend 2026'),
 * and at least two of them, so 'Rally Vsetín' doesn't match 'Rally Jizera'
 * and a one-word name matches nothing.
 */
export function sameRaceName(a: string, b: string): boolean {
  const wa = nameWords(a);
  const wb = nameWords(b);
  const shorter = wa.size <= wb.size ? wa : wb;
  const longer = shorter === wa ? wb : wa;
  let shared = 0;
  for (const w of shorter) if (longer.has(w)) shared++;
  return shared >= 2 && shared / shorter.size >= 0.75;
}

/**
 * The source names the place itself rather than the model guessing it:
 * every word of the place starts a word of the excerpt with its first three
 * letters ('Železný Brod' in "Rallye Jizera, Žel.Brod", 'Kyjov' in "…, Kyjov",
 * but not 'Liberec' in "Rallye Jizera (https://…)").
 */
export function statedIn(location: string, excerpt: string | null): boolean {
  if (!excerpt) return false;
  const words = fold(location).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !["nad", "pod"].includes(w));
  const starts = new Set(fold(excerpt).split(/[^a-z0-9]+/).filter(Boolean).map((w) => w.slice(0, 3)));
  return words.length > 0 && words.every((w) => starts.has(w.slice(0, 3)));
}
