// What the service worker keeps for use without a signal (web/sw/sw.ts), and the
// state it shares with the page. Pure functions, no DOM: shared by the worker,
// the page and the tests.
import type { EventDetail, EventLink, EventListItem, LinkKind } from "../../../src/shared/types.ts";

/** Cache names. The page reads STATE_KEY from META_CACHE to show what is saved. */
export const CACHES = {
  api: "zk-api",
  /** Tiles around saved races (managed by the sync, removed when the race is gone). */
  tilesSaved: "zk-tiles-saved",
  /** Tiles the visitor looked at (capped). */
  tiles: "zk-tiles",
  docs: "zk-docs",
  meta: "zk-meta",
  /** Map styles, TileJSON, fonts and icons of the base map. */
  map: "zk-map",
} as const;
export const SHELL_PREFIX = "zk-shell-";
export const STATE_KEY = "/__offline/state";

/** At most this many races of the coming weekend are saved automatically. */
export const MAX_WEEKEND_RACES = 8;

export interface OfflineRace {
  id: string;
  name: string;
  date_from: string;
  date_to: string | null;
  /** Saved by the visitor (else automatically, as a race of the coming weekend). */
  pinned: boolean;
  savedAt: string;
  /** Map tiles stored around the race. */
  tiles: number;
  /** Original URLs of the documents stored for offline use. */
  docs: string[];
  /** Weather forecast stored with the race (web/src/live.ts forecastUrl), absent in older states. */
  forecast?: string | null;
}

export interface OfflineState {
  /** Last finished sync (ISO), null before the first. */
  syncedAt: string | null;
  races: Record<string, OfflineRace>;
  /** The visitor's favourite races, as the page last sent them. */
  favorites?: string[];
  /** Vector tile URL template the stored tiles were fetched with (changes with each map build). */
  tileTemplate?: string;
}

export const EMPTY_STATE: OfflineState = { syncedAt: null, races: {} };

/** Messages from the page to the service worker (favourites: ids from the browser's prefs). */
export type ToWorker = { type: "sync"; force?: boolean; favorites?: string[] } | { type: "save"; id: string } | { type: "unsave"; id: string };
/** Message from the service worker: the offline state changed (busy = a save is running). */
export interface FromWorker {
  type: "offline-state";
  busy: string[];
}

/** Today's date in Czech time, 'YYYY-MM-DD'. */
export function todayInPrague(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(now);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** From today to the coming Sunday (Sunday itself: just today). */
export function weekendWindow(today: string): { from: string; to: string } {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return { from: today, to: addDays(today, dow === 0 ? 0 : 7 - dow) };
}

/** Races running or starting between today and Sunday, not cancelled, by date. */
export function weekendRaces(events: EventListItem[], today: string, max = MAX_WEEKEND_RACES, favorites: readonly string[] = []): EventListItem[] {
  const { from, to } = weekendWindow(today);
  const fav = new Set(favorites);
  return events
    .filter((e) => e.status === "planned" && e.organizer_flag !== "cancelled" && (e.date_to ?? e.date_from) >= from && e.date_from <= to)
    // The visitor's favourites first, so a busy weekend can't push them out.
    .sort((a, b) => Number(fav.has(b.id)) - Number(fav.has(a.id)) || a.date_from.localeCompare(b.date_from))
    .slice(0, max);
}

/** Still worth keeping: not over yet. */
export function isCurrent(r: Pick<OfflineRace, "date_from" | "date_to">, today: string): boolean {
  return (r.date_to ?? r.date_from) >= today;
}

// Map tiles: vector tiles of the base map (web/src/basemap.ts), URL template from its
// TileJSON. A race takes ~95 tiles (~30 at zoom 13–14) and tiles already stored
// are not fetched again.
/** Radius in km stored around a race per zoom: the area at a glance, the village in detail. */
const AROUND_RACE: [zoom: number, km: number][] = [
  [9, 25],
  [10, 25],
  [11, 25],
  [12, 12],
  [13, 4],
  [14, 2.5],
];
/** The whole country (map view) at low zooms. */
const CZ_BOUNDS = { south: 48.55, north: 51.06, west: 12.09, east: 18.86 };
const CZ_ZOOMS = [6, 7, 8];

function tileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}
function tileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

function tilesInBox(template: string, b: typeof CZ_BOUNDS, z: number): string[] {
  const urls: string[] = [];
  for (let x = tileX(b.west, z); x <= tileX(b.east, z); x++) {
    for (let y = tileY(b.north, z); y <= tileY(b.south, z); y++) urls.push(tileUrl(template, z, x, y));
  }
  return urls;
}

/** Tile URLs around a point (see AROUND_RACE); `template` like "https://…/{z}/{x}/{y}.pbf". */
export function tilesAround(template: string, lat: number, lng: number): string[] {
  const urls: string[] = [];
  for (const [z, km] of AROUND_RACE) {
    const dLat = km / 111.32;
    const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
    urls.push(...tilesInBox(template, { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng }, z));
  }
  return urls;
}

/** Tile URLs of the whole country at low zooms (the map view's starting picture). */
export function overviewTiles(template: string): string[] {
  return CZ_ZOOMS.flatMap((z) => tilesInBox(template, CZ_BOUNDS, z));
}

// Documents for spectators: PDFs and images the Worker hands out from our origin
// (src/docs.ts), so the service worker can keep them.
export const OFFLINE_DOC_KINDS: readonly LinkKind[] = ["harmonogram", "mapa", "divaci", "propozice", "plakat"];

export function offlineDocs(e: Pick<EventDetail, "links">): EventLink[] {
  const seen = new Set<string>();
  return (e.links ?? []).filter((l) => OFFLINE_DOC_KINDS.includes(l.kind) && /^https?:\/\//i.test(l.url) && !seen.has(l.url) && !!seen.add(l.url));
}

/** Our copy of a race's document (GET /api/events/<id>/doc?url=…). */
export function docUrl(eventId: string, url: string): string {
  return `/api/events/${eventId}/doc?url=${encodeURIComponent(url)}`;
}
