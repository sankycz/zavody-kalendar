import type { PoliteClient } from "./http.ts";

export interface GeoResult {
  lat: number;
  lng: number;
  region: string | null;
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

export function geocodeQuery(location: string, country: string): string {
  return `${location.trim()}, ${country.toUpperCase()}`;
}

/**
 * Nominatim geocoding with a D1 cache (`locations`). Misses are cached too
 * (found = 0) so the same unknown place isn't queried every week.
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
    .prepare("SELECT lat, lng, region, found FROM locations WHERE query = ?")
    .bind(query)
    .first<{ lat: number | null; lng: number | null; region: string | null; found: number }>();
  if (cached) {
    return cached.found && cached.lat != null && cached.lng != null
      ? { lat: cached.lat, lng: cached.lng, region: cached.region }
      : null;
  }

  const params = new URLSearchParams({
    q: location,
    countrycodes: country.toLowerCase(),
    format: "jsonv2",
    addressdetails: "1",
    limit: "1",
    "accept-language": "cs",
  });
  const res = await http.get(`${NOMINATIM}?${params}`);
  if (!res.ok) throw new Error(`Nominatim ${res.status} for '${query}'`);
  const hits = (await res.json()) as { lat: string; lon: string; address?: { state?: string } }[];
  const hit = hits[0];
  const result: GeoResult | null = hit
    ? { lat: Number(hit.lat), lng: Number(hit.lon), region: hit.address?.state ?? null }
    : null;

  await db
    .prepare("INSERT OR REPLACE INTO locations (query, lat, lng, region, found) VALUES (?, ?, ?, ?, ?)")
    .bind(query, result?.lat ?? null, result?.lng ?? null, result?.region ?? null, result ? 1 : 0)
    .run();
  return result;
}
