import { useSyncExternalStore } from "react";
import type { EventListItem } from "../../src/shared/types.ts";

// What the visitor keeps without an account: favourite races, home region, last
// list filters. Only in this browser (localStorage; for an installed app the
// app's own storage on the phone), never sent anywhere – no accounts, no GDPR.

export type FavoriteRace = Pick<EventListItem, "name" | "date_from" | "date_to">;

export interface Prefs {
  favorites: Record<string, FavoriteRace>;
  /** Home region (kraj) for the quick "Můj kraj" filter. */
  homeRegion: string | null;
  /** Query string of the last list filters (discipline, level, region, view, favourites). */
  lastList: string;
}

const KEY = "prefs-v1";
const EMPTY: Prefs = { favorites: {}, homeRegion: null, lastList: "" };
/** Favourites are forgotten this long after the race. */
const KEEP_PAST_DAYS = 60;

function read(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Prefs> | null;
    return v && typeof v === "object"
      ? {
          favorites: v.favorites && typeof v.favorites === "object" ? v.favorites : {},
          homeRegion: typeof v.homeRegion === "string" ? v.homeRegion : null,
          lastList: typeof v.lastList === "string" ? v.lastList : "",
        }
      : EMPTY;
  } catch {
    return EMPTY;
  }
}

let prefs = read();
const listeners = new Set<() => void>();

function update(patch: Partial<Prefs>): void {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage full or blocked: still applies for this visit */
  }
  for (const l of listeners) l();
}

// Another tab of the app changed them.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (ev) => {
    if (ev.key !== KEY) return;
    prefs = read();
    for (const l of listeners) l();
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export { subscribe as subscribePrefs };

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, () => prefs);
}

export function getPrefs(): Prefs {
  return prefs;
}

/** Ask the browser not to clear our storage when space runs low (granted silently to installed apps). */
function persist(): void {
  void navigator.storage?.persist?.().catch(() => false);
}

export function toggleFavorite(e: { id: string } & FavoriteRace): void {
  const favorites = { ...prefs.favorites };
  if (favorites[e.id]) delete favorites[e.id];
  else {
    favorites[e.id] = { name: e.name, date_from: e.date_from, date_to: e.date_to };
    persist();
  }
  update({ favorites });
}

export function setHomeRegion(region: string | null): void {
  update({ homeRegion: region || null });
}

export function rememberList(query: string): void {
  if (query !== prefs.lastList) update({ lastList: query });
}

/** Drop favourites of races long over (keeps the store small). */
export function pruneFavorites(today: string): void {
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() - KEEP_PAST_DAYS);
  const cutoff = limit.toISOString().slice(0, 10);
  const favorites = Object.fromEntries(Object.entries(prefs.favorites).filter(([, f]) => (f.date_to ?? f.date_from) >= cutoff));
  if (Object.keys(favorites).length !== Object.keys(prefs.favorites).length) update({ favorites });
}
