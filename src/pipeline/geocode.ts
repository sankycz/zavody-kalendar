import type { PoliteClient } from "./http.ts";

export interface GeoResult {
  lat: number;
  lng: number;
  region: string | null;
  /** Where the place actually is (ISO alpha-2); may differ from the extracted country. */
  country: string;
}

const OPEN_METEO = "https://geocoding-api.open-meteo.com/v1/search";

/** Countries tried when the place isn't found in the given one (the model sometimes gets the country wrong). */
const NEIGHBORS = ["CZ", "SK", "DE", "AT", "PL"];

interface OpenMeteoHit {
  latitude: number;
  longitude: number;
  country_code?: string;
  admin1?: string;
}

export function geocodeQuery(location: string, country: string): string {
  return `${location.trim()}, ${country.toUpperCase()}`;
}

/** GeoNames names Czech regions inconsistently ("Karlovarský", "Plzeňský kraj"): official names. */
export function czechRegion(admin1: string | null, countryCode: string | undefined): string | null {
  if (!admin1 || countryCode !== "CZ" || /kraj|Praha/i.test(admin1)) return admin1;
  return admin1 === "Vysočina" ? "Kraj Vysočina" : `${admin1} kraj`;
}

async function search(http: PoliteClient, name: string, country: string | null): Promise<OpenMeteoHit[]> {
  const params = new URLSearchParams({ name, count: "10", language: "cs", format: "json" });
  if (country) params.set("countryCode", country.toUpperCase());
  const res = await http.get(`${OPEN_METEO}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status} for '${name}'`);
  return ((await res.json()) as { results?: OpenMeteoHit[] }).results ?? [];
}

/**
 * Open-Meteo geocoding (GeoNames, no API key) with a D1 cache (`locations`).
 * Results are ranked by the API (bigger places first). A place not found in
 * its country is looked up in the neighboring ones. Misses are cached too
 * (found = 0) so the same unknown place isn't queried every day.
 * The PoliteClient must be configured with >= 1000 ms per host.
 */
export async function geocode(
  db: D1Database,
  http: PoliteClient,
  location: string,
  country: string,
): Promise<GeoResult | null> {
  const query = geocodeQuery(location, country);
  const cached = await db
    .prepare("SELECT lat, lng, region, country, found FROM locations WHERE query = ?")
    .bind(query)
    .first<{ lat: number | null; lng: number | null; region: string | null; country: string | null; found: number }>();
  if (cached) {
    return cached.found && cached.lat != null && cached.lng != null
      ? { lat: cached.lat, lng: cached.lng, region: cached.region, country: cached.country ?? country.toUpperCase() }
      : null;
  }

  const name = location.trim();
  let hit = (await search(http, name, country))[0];
  if (!hit) hit = (await search(http, name, null)).find((h) => h.country_code && NEIGHBORS.includes(h.country_code));
  const result: GeoResult | null = hit
    ? {
        lat: hit.latitude,
        lng: hit.longitude,
        region: czechRegion(hit.admin1 ?? null, hit.country_code),
        country: hit.country_code ?? country.toUpperCase(),
      }
    : null;

  await db
    .prepare("INSERT OR REPLACE INTO locations (query, lat, lng, region, country, found) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(query, result?.lat ?? null, result?.lng ?? null, result?.region ?? null, result?.country ?? null, result ? 1 : 0)
    .run();
  return result;
}

export interface BackfillReport {
  checked: number;
  geocoded: number;
  /** First few failures (distinct messages). */
  errors: string[];
}

/**
 * Geocode stored events that have a place but no coordinates yet (e.g. after
 * the geocoder was unreachable during ingest). Cached places cost no request.
 * A place found abroad sets the event's country (the API lists only CZ).
 */
export async function backfillCoordinates(db: D1Database, http: PoliteClient, limit: number): Promise<BackfillReport> {
  const { results } = await db
    .prepare(
      `SELECT id, location_name, country FROM events
       WHERE lat IS NULL AND location_name IS NOT NULL
       ORDER BY date_from DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: string; location_name: string; country: string }>();
  const report: BackfillReport = { checked: results.length, geocoded: 0, errors: [] };
  for (const e of results) {
    try {
      const g = await geocode(db, http, e.location_name, e.country);
      if (!g) continue;
      await db
        .prepare("UPDATE events SET lat = ?, lng = ?, region = COALESCE(region, ?), country = ? WHERE id = ?")
        .bind(g.lat, g.lng, g.region, g.country, e.id)
        .run();
      report.geocoded++;
    } catch (err) {
      const msg = String(err);
      if (report.errors.length < 3 && !report.errors.includes(msg)) report.errors.push(msg);
    }
  }
  return report;
}
