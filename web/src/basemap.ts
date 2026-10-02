// Base map: OpenFreeMap vector tiles (OpenStreetMap data, free, no key, no quota),
// drawn by MapLibre GL with a native light and dark style. One place to change
// the provider (e.g. to self-hosted Protomaps on Cloudflare R2). No DOM here:
// shared with the service worker (web/sw/sw.ts).

export const MAP_HOST = "tiles.openfreemap.org";

/** Light: Liberty (roads, forests, terrain colours); dark: Dark Matter. */
export const MAP_STYLES = {
  light: `https://${MAP_HOST}/styles/liberty`,
  dark: `https://${MAP_HOST}/styles/dark`,
} as const;

/**
 * TileJSON of the vector tiles. Tile URLs carry the planet's version
 * (…/planet/20260930_001001_pt/{z}/{x}/{y}.pbf) and change with every weekly
 * build; the style points here, so tiles stored offline must match the stored TileJSON.
 */
export const TILEJSON_URL = `https://${MAP_HOST}/planet`;

/** The vector tiles go up to zoom 14; MapLibre draws closer views from those. */
export const TILE_MAX_ZOOM = 14;

/** Glyph ranges stored for offline labels: Basic Latin and Latin Extended-A (č, ř, ž, ů…). */
export const OFFLINE_GLYPH_RANGES = ["0-255", "256-511"];
