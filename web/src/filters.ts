import type { Discipline, Level } from "../../src/shared/types.ts";
import { DISCIPLINE_LABEL, LEVEL_LABEL } from "./labels.ts";

export type View = "list" | "map";
/** "near" = by distance from the visitor (position kept in the browser, never in the URL). */
export type Sort = "date" | "near";

export interface Filters {
  discipline: Discipline[];
  level: Level[];
  region: string;
  from: string;
  to: string;
  view: View;
  sort: Sort;
  /** Full-text search: null = search bar closed, "" = open and empty. */
  q: string | null;
}

export const DISCIPLINES = Object.keys(DISCIPLINE_LABEL) as Discipline[];
export const LEVELS = Object.keys(LEVEL_LABEL) as Level[];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function csv<T extends string>(v: string | null, allowed: readonly T[]): T[] {
  return (v ?? "").split(",").filter((x): x is T => (allowed as readonly string[]).includes(x));
}

/** Filters from the page URL; unknown values are dropped. */
export function parseFilters(params: URLSearchParams): Filters {
  const date = (k: string) => {
    const v = params.get(k) ?? "";
    return ISO.test(v) ? v : "";
  };
  return {
    discipline: csv(params.get("discipline"), DISCIPLINES),
    level: csv(params.get("level"), LEVELS),
    region: (params.get("region") ?? "").slice(0, 100),
    from: date("from"),
    to: date("to"),
    view: params.get("view") === "map" ? "map" : "list",
    sort: params.get("sort") === "near" ? "near" : "date",
    q: params.has("q") ? params.get("q")!.slice(0, 100) : null,
  };
}

function toParams(f: Filters, withView: boolean): URLSearchParams {
  const p = new URLSearchParams();
  if (f.discipline.length) p.set("discipline", f.discipline.join(","));
  if (f.level.length) p.set("level", f.level.join(","));
  if (f.region) p.set("region", f.region);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (withView && f.view === "map") p.set("view", "map");
  if (withView && f.sort === "near") p.set("sort", "near");
  // The page keeps an open, empty search bar; the API only gets real words.
  if (f.q !== null && (withView || f.q.trim())) p.set("q", withView ? f.q : f.q.trim());
  return p;
}

/** Page URL for the list with these filters (shareable). */
export function listHref(f: Filters): string {
  const q = toParams(f, true).toString();
  return q ? `/?${q}` : "/";
}

/** API URL for these filters (view is UI-only). */
export function eventsApiUrl(f: Filters): string {
  const q = toParams(f, false).toString();
  return q ? `/api/events?${q}` : "/api/events";
}

/** Date range of a whole season (calendar year). */
export function seasonRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** The season the filters show as a whole (set by the season switch), or null. */
export function seasonOf(f: Pick<Filters, "from" | "to">): number | null {
  const m = /^(\d{4})-01-01$/.exec(f.from);
  if (!m) return null;
  const year = Number(m[1]);
  return f.to === "" || f.to === `${year}-12-31` ? year : null;
}

/** Filters the visitor set in the filter panel (the season switch isn't one of them). */
export function activeFilterCount(f: Filters): number {
  if (seasonOf(f) !== null) return f.discipline.length + f.level.length + (f.region ? 1 : 0);
  return f.discipline.length + f.level.length + (f.region ? 1 : 0) + (f.from ? 1 : 0) + (f.to ? 1 : 0);
}

export const EMPTY_FILTERS: Filters = { discipline: [], level: [], region: "", from: "", to: "", view: "list", sort: "date", q: null };
