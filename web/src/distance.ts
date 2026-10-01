/** Plain geometry for "near me" (no browser APIs, unit-tested). */

export interface Position {
  lat: number;
  lng: number;
}

/** Great-circle distance in km. */
export function distanceKm(a: Position, b: Position): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** "850 m", "12 km", "1 240 km" */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000 / 50) * 50} m`;
  return `${Math.round(km).toLocaleString("cs-CZ")} km`;
}
