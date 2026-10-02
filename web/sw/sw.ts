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
const TILE_HOST = "tile.openstreetmap.org";
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
  if (url.host === TILE_HOST) return event.respondWith(tile(req));
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

/** Map tiles: saved or viewed ones from the cache; new ones fetched with CORS so they can be stored. */
async function tile(req: Request): Promise<Response> {
  const cached = (await caches.match(req.url, { cacheName: CACHES.tilesSaved })) ?? (await caches.match(req.url, { cacheName: CACHES.tiles }));
  if (cached) return cached;
  try {
    const res = await fetch(req.url, { mode: "cors", credentials: "omit" });
    if (res.ok) {
      const cache = await caches.open(CACHES.tiles);
      await cache.put(req.url, res.clone());
      if (Math.random() < 0.05) void trim(cache, MAX_VIEWED_TILES);
    }
    return res;
  } catch {
    return fetch(req);
  }
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
async function saveRace(id: string, pinned: boolean): Promise<OfflineRace> {
  busy.add(id);
  void broadcast();
  try {
    const e = await fetchApi<EventDetail>(`/api/events/${id}`);
    const tiles = e.lat != null && e.lng != null ? await fill(CACHES.tilesSaved, tilesAround(e.lat, e.lng), { mode: "cors", credentials: "omit" }, 3) : [];
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
  const tiles = new Set(overviewTiles());
  const docs = new Set<string>();
  for (const e of races) {
    if (e.lat != null && e.lng != null) for (const t of tilesAround(e.lat, e.lng)) tiles.add(t);
    for (const l of offlineDocs(e)) docs.add(new URL(docUrl(e.id, l.url), self.location.origin).href);
  }
  const tileCache = await caches.open(CACHES.tilesSaved);
  for (const k of await tileCache.keys()) if (!tiles.has(k.url)) await tileCache.delete(k);
  const docCache = await caches.open(CACHES.docs);
  for (const k of await docCache.keys()) if (!docs.has(k.url)) await docCache.delete(k);
}

async function sync(force: boolean): Promise<void> {
  const state = await readState();
  if (!force && state.syncedAt && Date.now() - Date.parse(state.syncedAt) < SYNC_EVERY_MS) return;
  const today = todayInPrague();
  const list = await fetchApi<EventsResponse>("/api/events");
  await fetchApi("/api/regions").catch(() => {});
  await fill(CACHES.tilesSaved, overviewTiles(), { mode: "cors", credentials: "omit" }, 3);

  const pinned = Object.values(state.races).filter((r) => r.pinned && isCurrent(r, today));
  const wanted = new Map<string, boolean>(weekendRaces(list.events, today).map((e) => [e.id, false]));
  for (const r of pinned) wanted.set(r.id, true);

  const races: Record<string, OfflineRace> = {};
  for (const [id, pin] of wanted) {
    try {
      races[id] = await saveRace(id, pin);
    } catch (err) {
      // Not reachable now: keep what an earlier sync stored.
      if (state.races[id]) races[id] = { ...state.races[id]!, pinned: pin };
      console.warn("offline: race", id, err);
    }
    await writeState({ ...state, races: { ...state.races, ...races } });
    void broadcast();
  }

  const next: OfflineState = { syncedAt: new Date().toISOString(), races };
  await writeState(next);
  await prune(next);
  await broadcast();
}

async function save(id: string): Promise<void> {
  const r = await saveRace(id, true);
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
    .then((l) => (l ? weekendRaces(l.events, todayInPrague()).some((e) => e.id === id) : false))
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
      ? enqueue(() => sync(msg.force === true))
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
