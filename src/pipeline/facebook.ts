import { todayInPrague } from "../api.ts";
import type { GeoResult } from "./geocode.ts";
import { fold, normalizeUrl } from "./normalize.ts";

/**
 * Facebook events through the Apify actor apify/facebook-events-scraper.
 * The actor's items are already structured; they are turned into one text
 * line per event and go through the same model extraction as a web page
 * (car races only, discipline, level). Facebook's own coordinates of the
 * place are kept for the map.
 */

/** The fields of an actor item we use (the actor returns many more). */
export interface FbEvent {
  url?: string;
  name?: string;
  utcStartDate?: string;
  duration?: string | null;
  isCanceled?: boolean;
  isOnline?: boolean;
  isPast?: boolean;
  description?: string | null;
  location?: {
    name?: string | null;
    city?: string | null;
    countryCode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
}

export interface FbTargets {
  startUrls: string[];
  searchQueries: string[];
}

/** `sources.url` of a facebook source: one Facebook URL or search phrase per line. */
export function parseTargets(spec: string): FbTargets {
  const lines = spec.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    startUrls: lines.filter((l) => /^https?:\/\//.test(l)),
    searchQueries: lines.filter((l) => !/^https?:\/\//.test(l)),
  };
}

export interface ApifyEvents {
  events(targets: FbTargets): Promise<FbEvent[]>;
}

const ACTOR = "apify~facebook-events-scraper";

/**
 * Runs the actor synchronously (max. 5 min) and returns its dataset.
 * `maxEvents` caps the pay-per-event cost (about $0.01 per event).
 */
export function apifyEvents(
  token: string,
  maxEvents: number,
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
): ApifyEvents {
  return {
    async events(targets) {
      const params = new URLSearchParams({ timeout: "280", maxTotalChargeUsd: String(Math.ceil(maxEvents * 0.02)) });
      const res = await fetcher(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?${params}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...targets, maxEvents }),
      });
      if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const items = (await res.json()) as unknown;
      if (!Array.isArray(items)) throw new Error("Apify: dataset is not an array");
      return items as FbEvent[];
    },
  };
}

/** Contact details don't belong in the calendar (nor in the stored excerpt). */
function clean(s: string, max: number): string {
  const t = s
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "")
    .replace(/(\+?\d[\d ]{7,}\d)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

const DESCRIPTION = " | popis: ";

/** "…| popis: …" is context for the model, not part of the stored excerpt. */
export function excerptWithoutDescription(excerpt: string | null): string | null {
  if (excerpt == null) return null;
  const i = excerpt.indexOf(DESCRIPTION);
  return i >= 0 ? excerpt.slice(0, i) : excerpt;
}

export interface FacebookInput {
  /** One line per event, fed to the model like a web page. */
  text: string;
  /** Facebook's coordinates by event URL and by folded event name. */
  points: Map<string, GeoResult>;
  /** Events left out before the model (past, online, abroad, no place, other season). */
  skipped: number;
}

/**
 * Upcoming events in the Czech Republic with a known place, as model input +
 * their coordinates. Past events are left out: the organizers' calendars cover
 * those, and Facebook's place and day often differ from them (the event of a
 * rally sits at its service park, on its main day), so they'd come back as duplicates.
 */
export function facebookInput(items: FbEvent[], season: number): FacebookInput {
  const seen = new Set<string>();
  const kept: { e: FbEvent; url: string; date: string; lat: number; lng: number }[] = [];
  for (const e of items) {
    const url = normalizeUrl(e.url);
    const loc = e.location;
    if (!url || !e.name || !e.utcStartDate || e.isPast || e.isOnline || seen.has(url)) continue;
    if (loc?.countryCode !== "CZ" || typeof loc.latitude !== "number" || typeof loc.longitude !== "number") continue;
    const date = todayInPrague(new Date(e.utcStartDate));
    if (Number(date.slice(0, 4)) !== season) continue;
    seen.add(url);
    kept.push({ e, url, date, lat: loc.latitude, lng: loc.longitude });
  }
  kept.sort((a, b) => a.date.localeCompare(b.date));

  const points = new Map<string, GeoResult>();
  const lines = kept.map(({ e, url, date, lat, lng }) => {
    const point: GeoResult = { lat, lng, region: null, country: "CZ" };
    points.set(url, point);
    points.set(fold(e.name!), point);
    const place = [e.location?.name, e.location?.city].filter(Boolean).join(", ");
    return [
      `${date} | ${clean(e.name!, 200)} | místo: ${clean(place, 200)} | ${url}`,
      e.duration ? ` | trvání: ${e.duration}` : "",
      e.isCanceled ? " | ZRUŠENO" : "",
      e.description ? `${DESCRIPTION}${clean(e.description, 400)}` : "",
    ].join("");
  });
  const header = "Události z Facebooku (datum začátku | název | místo | odkaz | …). Každý řádek je jedna událost.";
  return { text: [header, ...lines].join("\n"), points, skipped: items.length - kept.length };
}

/** Facebook's point for an extracted event: by its URL, else by its name. */
export function facebookPoint(points: Map<string, GeoResult>, websiteUrl: string | null, name: string): GeoResult | undefined {
  const url = normalizeUrl(websiteUrl);
  return (url ? points.get(url) : undefined) ?? points.get(fold(name));
}
