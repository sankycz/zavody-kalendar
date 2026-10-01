import { useEffect, useState } from "react";
import type { EventsResponse } from "../../src/shared/types.ts";
import { cachedJson, prefetchJson } from "./useJson.ts";

/**
 * The races in the order the visitor last saw them in the list (filters,
 * search and "near me" included). Swiping on a race detail moves along it.
 * Kept in sessionStorage so a reload of the detail still knows it.
 */
export interface RaceRef {
  id: string;
  name: string;
}

const KEY = "race-order";
let order: RaceRef[] = read();

function read(): RaceRef[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as RaceRef[]) : [];
  } catch {
    return [];
  }
}

export function setRaceOrder(races: RaceRef[]): void {
  order = races.map(({ id, name }) => ({ id, name }));
  try {
    sessionStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    /* storage unavailable: the order lives for this page only */
  }
}

/** Neighbours of a race, by the list order: pure, for tests. */
export function neighboursIn(races: RaceRef[], id: string): { prev: RaceRef | null; next: RaceRef | null } {
  const i = races.findIndex((r) => r.id === id);
  if (i < 0) return { prev: null, next: null };
  return { prev: races[i - 1] ?? null, next: races[i + 1] ?? null };
}

const DEFAULT_LIST = "/api/events";

/**
 * Previous and next race of a detail. Opened straight from a link (no list
 * seen yet), it falls back to the upcoming races. The neighbours' details are
 * prefetched so a swipe shows them at once.
 */
export function useNeighbours(id: string): { prev: RaceRef | null; next: RaceRef | null } {
  const [races, setRaces] = useState<RaceRef[]>(() =>
    order.some((r) => r.id === id) ? order : (cachedJson<EventsResponse>(DEFAULT_LIST)?.events ?? []),
  );

  // Once per race: the list order if it has the race, else the upcoming races.
  useEffect(() => {
    if (order.some((r) => r.id === id)) return setRaces(order);
    if (races.some((r) => r.id === id)) return;
    let alive = true;
    fetch(DEFAULT_LIST)
      .then((r) => (r.ok ? (r.json() as Promise<EventsResponse>) : null))
      .then((d) => {
        if (alive && d) setRaces(d.events.map(({ id, name }) => ({ id, name })));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // `races` is only read here: refetching whenever it changes would loop.
  }, [id]);

  const n = neighboursIn(races, id);
  useEffect(() => {
    for (const r of [n.prev, n.next]) if (r) prefetchJson(`/api/events/${r.id}`);
  }, [n.prev, n.next]);
  return n;
}
