/// <reference lib="webworker" />
// Service worker: the app works without a signal at the track.
//
// - App shell (built files, icons) precached; pages fall back to it offline.
// - API: network first with a short timeout (a weak signal in the woods is worse
//   than none), the last answer from the cache otherwise.
// - Races of the coming weekend (and races the visitor saved) are kept whole:
//   detail, map tiles around the place, PDF/image documents for spectators.
//   Synced when the app opens, comes back online, or by Periodic Background Sync.
import type { EventDetail, EventsResponse } from "../../src/shared/types.ts";
import {
  CACHES,
  EMPTY_STATE,
  SHELL_PREFIX,
  STATE_KEY,
  docUrl,
  isCurrent,
  offlineDocs,
  overviewTiles,
  tilesAround,
  todayInPrague,
  weekendRaces,
  type FromWorker,
  type OfflineRace,
  type OfflineState,
  type ToWorker,
} from "../src/offline/plan.ts";
import { MAP_HOST, MAP_STYLES, OFFLINE_GLYPH_RANGES, TILEJSON_URL } from "../src/basemap.ts";
import { forecastUrl } from "../src/live.ts";

declare const self: ServiceWorkerGlobalScope;
/** Filled in at build time (vite.config.ts). */
declare const __PRECACHE__: string[];
declare const __VERSION__: string;

const SHELL = `${SHELL_PREFIX}${__VERSION__}`;
const API_TIMEOUT_MS = 4000;
const PAGE_TIMEOUT_MS = 3000;
/** Automatic sync at most this often (a forced one always runs). */
const SYNC_EVERY_MS = 6 * 3600_000;
const MAX_API_ENTRIES = 80;
const MAX_VIEWED_TILES = 1500;
const MAX_MAP_ASSETS = 300;
const WEATHER_HOST = "api.open-meteo.com";

// ---------- install / activate ----------

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await cache.addAll(__PRECACHE__);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Keep the previous shell too: a page still running the old version may lazy-load its chunks.
      const old = (await caches.keys()).filter((k) => k.startsWith(SHELL_PREFIX) && k !== SHELL);
      await Promise.all(old.slice(0, -1).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// ---------- fetch ----------

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/admin/")) return;
    if (/^\/api\/events\/[0-9a-f]{32}\/doc$/.test(url.pathname)) return event.respondWith(cacheFirst(req, CACHES.docs, false));
    if (url.pathname.endsWith("/ics")) return; // calendar entry: straight to the network, not worth storing
    if (url.pathname.startsWith("/api/")) return event.respondWith(apiNetworkFirst(req));
    if (req.mode === "navigate") return event.respondWith(page(req));
    return event.respondWith(staticAsset(req));
  }
  if (url.host === MAP_HOST) {
    // Styles and the TileJSON change with the weekly map build: network first.
    if (url.pathname.startsWith("/styles/") || url.pathname === "/planet") {
      return event.respondWith(networkFirst(req, API_TIMEOUT_MS, (res) => putMap(req.url, res), () => caches.match(req.url, { cacheName: CACHES.map })).catch(() => Response.error()));
    }
    if (url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/sprites/")) return event.respondWith(mapAsset(req));
    if (url.pathname.endsWith(".pbf")) return event.respondWith(tile(req));
  }
  // Forecast on the race-day page: the last one stays readable without a signal.
  if (url.host === WEATHER_HOST) return event.respondWith(apiNetworkFirst(req));
});

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

/** Network with a time limit; the request keeps going (and updates the cache) after the limit. */
async function networkFirst(req: Request, ms: number, store: (res: Response) => Promise<void>, fallback: () => Promise<Response | undefined>): Promise<Response> {
  const net = fetch(req).then(async (res) => {
    if (res.ok) await store(res.clone());
    return res;
  });
  try {
    return await Promise.race([net, timeout(ms)]);
  } catch {
    const cached = await fallback();
    if (cached) {
      net.catch(() => {});
      return cached;
    }
    return net;
  }
}

async function apiNetworkFirst(req: Request): Promise<Response> {
  try {
    return await networkFirst(
      req,
      API_TIMEOUT_MS,
      (res) => putApi(req.url, res),
      () => caches.match(req, { cacheName: CACHES.api }),
    );
  } catch {
    return Response.json({ error: "offline" }, { status: 503, headers: { "X-Offline": "1" } });
  }
}

async function putApi(url: string, res: Response): Promise<void> {
  const cache = await caches.open(CACHES.api);
  await cache.put(url, res);
  const keep = savedApi ?? savedApiUrls(await readState());
  await trim(cache, MAX_API_ENTRIES, (k) => !keep.has(k.url));
}

/** The default list, details and forecasts of saved races are never trimmed away. */
let savedApi: Set<string> | null = null;
function savedApiUrls(state: OfflineState): Set<string> {
  const abs = (path: string) => new URL(path, self.location.origin).href;
  savedApi = new Set([abs("/api/events"), abs("/api/regions")]);
  for (const r of Object.values(state.races)) {
    savedApi.add(abs(`/api/events/${r.id}`));
    if (r.forecast) savedApi.add(r.forecast);
  }
  return savedApi;
}

/** Delete the oldest entries above `max` (keys come in insertion order). */
async function trim(cache: Cache, max: number, removable: (k: Request) => boolean = () => true): Promise<void> {
  const keys = (await cache.keys()).filter(removable);
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

async function page(req: Request): Promise<Response> {
  try {
    return await networkFirst(
      req,
      PAGE_TIMEOUT_MS,
      async () => {},
      () => caches.match("/", { cacheName: SHELL }),
    );
  } catch {
    return (await caches.match("/")) ?? new Response("Offline", { status: 503 });
  }
}

/** Built files have hashed names: cache first, whichever shell holds them. */
async function staticAsset(req: Request): Promise<Response> {
  const cached = await caches.match(req, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok && new URL(req.url).pathname.startsWith("/assets/")) {
    const cache = await caches.open(SHELL);
    await cache.put(req, res.clone());
  }
  return res;
}

async function cacheFirst(req: Request, cacheName: string, store: boolean): Promise<Response> {
  const cached = await caches.match(req, { cacheName });
  if (cached) return cached;
  const res = await fetch(req);
  if (store && res.ok) await (await caches.open(cacheName)).put(req, res.clone());
  return res;
}

/** Vector tiles: saved or viewed ones from the cache, new ones stored (capped). */
async function tile(req: Request): Promise<Response> {
  const cached = await storedTile(req.url);
  if (cached) return cached;
  let res: Response;
  try {
    res = await fetch(req.url, { mode: "cors", credentials: "omit" });
  } catch (err) {
    // No signal and a newer map build than the stored tiles: the same tile from the stored build.
    const older = await olderBuildTile(req.url);
    if (older) return older;
    throw err;
  }
  if (res.ok) {
    const cache = await caches.open(CACHES.tiles);
    await cache.put(req.url, res.clone());
    if (Math.random() < 0.05) void trim(cache, MAX_VIEWED_TILES);
  }
  return res;
}

async function storedTile(url: string): Promise<Response | undefined> {
  return (await caches.match(url, { cacheName: CACHES.tilesSaved })) ?? (await caches.match(url, { cacheName: CACHES.tiles }));
}

async function olderBuildTile(url: string): Promise<Response | undefined> {
  const m = /\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url);
  const template = (await readState()).tileTemplate;
  if (!m || !template) return undefined;
  const older = template.replace("{z}", m[1]!).replace("{x}", m[2]!).replace("{y}", m[3]!);
  return older === url ? undefined : storedTile(older);
}

async function putMap(url: string, res: Response): Promise<void> {
  const cache = await caches.open(CACHES.map);
  await cache.put(url, res);
}

/** Fonts and icons of the map style: they don't change under the same URL. */
async function mapAsset(req: Request): Promise<Response> {
  const cached = await caches.match(req.url, { cacheName: CACHES.map });
  if (cached) return cached;
  const res = await fetch(req.url, { mode: "cors", credentials: "omit" });
  if (res.ok) {
    const cache = await caches.open(CACHES.map);
    await cache.put(req.url, res.clone());
    if (Math.random() < 0.05) void trim(cache, MAX_MAP_ASSETS, (k) => !k.url.includes("/styles/") && !k.url.endsWith("/planet"));
  }
  return res;
}

const CORS: RequestInit = { mode: "cors", credentials: "omit" };

/** Current vector tile URL template (TileJSON), stored for offline use. */
async function tileTemplate(): Promise<string> {
  const res = await fetch(TILEJSON_URL, { ...CORS, cache: "no-cache" });
  if (!res.ok) throw new Error(`TileJSON: ${res.status}`);
  await putMap(TILEJSON_URL, res.clone());
  const tj = (await res.json()) as { tiles?: string[] };
  const t = tj.tiles?.[0];
  if (!t || !t.includes("{z}")) throw new Error("TileJSON without tiles");
  return t;
}

/** Both styles with their icons and the fonts for Czech labels, so the map draws without a signal. */
async function storeMapStyles(): Promise<void> {
  const cache = await caches.open(CACHES.map);
  const assets = new Set<string>();
  for (const url of Object.values(MAP_STYLES)) {
    const res = await fetch(url, { ...CORS, cache: "no-cache" });
    if (!res.ok) continue;
    await cache.put(url, res.clone());
    const style = (await res.json()) as { sprite?: string | { url: string }[]; glyphs?: string; layers?: { layout?: { "text-font"?: unknown } }[] };
    const sprites = typeof style.sprite === "string" ? [style.sprite] : (style.sprite ?? []).map((s) => s.url);
    for (const sp of sprites) for (const suffix of [".json", ".png", "@2x.json", "@2x.png"]) assets.add(sp + suffix);
    const fonts = new Set<string>();
    for (const l of style.layers ?? []) {
      const f = l.layout?.["text-font"];
      if (Array.isArray(f) && f.every((x) => typeof x === "string")) fonts.add(f.join(","));
    }
    if (style.glyphs) {
      for (const f of fonts) for (const r of OFFLINE_GLYPH_RANGES) assets.add(style.glyphs.replace("{fontstack}", encodeURIComponent(f)).replace("{range}", r));
    }
  }
  await fill(CACHES.map, [...assets], CORS, 3);
}

// ---------- offline state ----------

async function readState(): Promise<OfflineState> {
  try {
    const res = await caches.match(STATE_KEY, { cacheName: CACHES.meta });
    return res ? ((await res.json()) as OfflineState) : structuredClone(EMPTY_STATE);
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

async function writeState(state: OfflineState): Promise<void> {
  const cache = await caches.open(CACHES.meta);
  await cache.put(STATE_KEY, Response.json(state));
  savedApiUrls(state);
}

const busy = new Set<string>();
async function broadcast(): Promise<void> {
  const msg: FromWorker = { type: "offline-state", busy: [...busy] };
  for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage(msg);
}

/** One sync or save at a time. */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T | undefined> {
  const run = queue.then(job, job).catch((err: unknown) => {
    console.warn("offline:", err);
    return undefined;
  });
  queue = run;
  return run;
}

async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  await putApi(new URL(path, self.location.origin).href, res.clone());
  return (await res.json()) as T;
}

/** Fetch what's missing, a few at a time; returns how many of `urls` are stored. */
async function fill(cacheName: string, urls: string[], init: RequestInit, parallel: number): Promise<string[]> {
  const cache = await caches.open(cacheName);
  const stored: string[] = [];
  const todo: string[] = [];
  for (const u of urls) ((await cache.match(u)) ? stored : todo).push(u);
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const u = todo[i++]!;
      try {
        const res = await fetch(u, init);
        if (res.ok) {
          await cache.put(u, res);
          stored.push(u);
        }
      } catch {
        /* offline again, or the host refused: next time */
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return stored;
}

/** Store one race whole: detail, tiles around it, its documents. */
async function saveRace(id: string, pinned: boolean, template: string | undefined): Promise<OfflineRace> {
  busy.add(id);
  void broadcast();
  try {
    const e = await fetchApi<EventDetail>(`/api/events/${id}`);
    const tiles = template && e.lat != null && e.lng != null ? await fill(CACHES.tilesSaved, tilesAround(template, e.lat, e.lng), CORS, 3) : [];
    const forecast = e.lat != null && e.lng != null ? forecastUrl(e.lat, e.lng) : null;
    if (forecast) await fetchApi(forecast).catch(() => {});
    const docs = offlineDocs(e);
    const stored = new Set(await fill(CACHES.docs, docs.map((l) => new URL(docUrl(id, l.url), self.location.origin).href), {}, 2));
    return {
      id,
      name: e.name,
      date_from: e.date_from,
      date_to: e.date_to,
      pinned,
      savedAt: new Date().toISOString(),
      tiles: tiles.length,
      forecast,
      docs: docs.filter((l) => stored.has(new URL(docUrl(id, l.url), self.location.origin).href)).map((l) => l.url),
    };
  } finally {
    busy.delete(id);
  }
}

/** Drop tiles and documents no saved race needs any more. */
async function prune(state: OfflineState): Promise<void> {
  const races: EventDetail[] = [];
  for (const id of Object.keys(state.races)) {
    const res = await caches.match(`/api/events/${id}`, { cacheName: CACHES.api });
    if (res) races.push((await res.json()) as EventDetail);
  }
  const template = state.tileTemplate;
  const tiles = new Set(template ? overviewTiles(template) : []);
  const docs = new Set<string>();
  for (const e of races) {
    if (template && e.lat != null && e.lng != null) for (const t of tilesAround(template, e.lat, e.lng)) tiles.add(t);
    for (const l of offlineDocs(e)) docs.add(new URL(docUrl(e.id, l.url), self.location.origin).href);
  }
  // Without a known template (TileJSON never fetched) keep what is there.
  const tileCache = await caches.open(CACHES.tilesSaved);
  if (template) for (const k of await tileCache.keys()) if (!tiles.has(k.url)) await tileCache.delete(k);
  const docCache = await caches.open(CACHES.docs);
  for (const k of await docCache.keys()) if (!docs.has(k.url)) await docCache.delete(k);
}

async function sync(force: boolean, favorites?: string[]): Promise<void> {
  const state = await readState();
  const favChanged = !!favorites && [...favorites].sort().join() !== [...(state.favorites ?? [])].sort().join();
  if (favorites) state.favorites = favorites;
  // A new map build changes every tile URL: the stored tiles must follow, whatever the schedule.
  const template = await tileTemplate().catch(() => state.tileTemplate);
  const mapChanged = !!template && template !== state.tileTemplate;
  if (template) state.tileTemplate = template;
  if (!force && !favChanged && !mapChanged && state.syncedAt && Date.now() - Date.parse(state.syncedAt) < SYNC_EVERY_MS) {
    if (favorites) await writeState(state);
    return;
  }
  const today = todayInPrague();
  const list = await fetchApi<EventsResponse>("/api/events");
  await fetchApi("/api/regions").catch(() => {});
  await storeMapStyles().catch((err: unknown) => console.warn("offline: map styles", err));
  if (template) await fill(CACHES.tilesSaved, overviewTiles(template), CORS, 3);

  const pinned = Object.values(state.races).filter((r) => r.pinned && isCurrent(r, today));
  const wanted = new Map<string, boolean>(weekendRaces(list.events, today, undefined, state.favorites).map((e) => [e.id, false]));
  for (const r of pinned) wanted.set(r.id, true);

  const races: Record<string, OfflineRace> = {};
  for (const [id, pin] of wanted) {
    try {
      races[id] = await saveRace(id, pin, template);
    } catch (err) {
      // Not reachable now: keep what an earlier sync stored.
      if (state.races[id]) races[id] = { ...state.races[id]!, pinned: pin };
      console.warn("offline: race", id, err);
    }
    await writeState({ ...state, races: { ...state.races, ...races } });
    void broadcast();
  }

  const next: OfflineState = {
    syncedAt: new Date().toISOString(),
    races,
    ...(state.favorites ? { favorites: state.favorites } : {}),
    ...(template ? { tileTemplate: template } : {}),
  };
  await writeState(next);
  await prune(next);
  await broadcast();
}

async function save(id: string): Promise<void> {
  const template = await tileTemplate().catch(async () => (await readState()).tileTemplate);
  const r = await saveRace(id, true, template);
  const state = await readState();
  await writeState({ ...state, races: { ...state.races, [id]: r } });
  await broadcast();
}

async function unsave(id: string): Promise<void> {
  const state = await readState();
  const r = state.races[id];
  if (!r) return;
  // A race of the coming weekend stays (automatically), just not pinned.
  const weekend = await caches
    .match("/api/events", { cacheName: CACHES.api })
    .then((res) => res?.json() as Promise<EventsResponse> | undefined)
    .then((l) => (l ? weekendRaces(l.events, todayInPrague(), undefined, state.favorites).some((e) => e.id === id) : false))
    .catch(() => false);
  const races = { ...state.races };
  if (weekend) races[id] = { ...r, pinned: false };
  else delete races[id];
  const next = { ...state, races };
  await writeState(next);
  await prune(next);
  await broadcast();
}

self.addEventListener("message", (event) => {
  const msg = event.data as ToWorker | undefined;
  if (!msg || typeof msg !== "object") return;
  const id = "id" in msg && /^[0-9a-f]{32}$/.test(msg.id) ? msg.id : null;
  const job =
    msg.type === "sync"
      ? enqueue(() => sync(msg.force === true, Array.isArray(msg.favorites) ? msg.favorites.filter((f) => /^[0-9a-f]{32}$/.test(f)) : undefined))
      : msg.type === "save" && id
        ? enqueue(() => save(id))
        : msg.type === "unsave" && id
          ? enqueue(() => unsave(id))
          : null;
  if (job) event.waitUntil(job);
});

// Chrome, installed app: refresh the weekend's races in the background now and then.
interface PeriodicSyncEvent extends ExtendableEvent {
  tag: string;
}
self.addEventListener("periodicsync", ((event: PeriodicSyncEvent) => {
  if (event.tag === "weekend-races") event.waitUntil(enqueue(() => sync(false)));
}) as EventListener);
