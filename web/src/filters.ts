import type { Discipline, Level } from "../../src/shared/types.ts";
import { DISCIPLINE_LABEL, LEVEL_LABEL } from "./labels.ts";

export type View = "list" | "map";

export interface Filters {
  discipline: Discipline[];
  level: Level[];
  region: string;
  from: string;
  to: string;
  view: View;
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

export function activeFilterCount(f: Filters): number {
  return f.discipline.length + f.level.length + (f.region ? 1 : 0) + (f.from ? 1 : 0) + (f.to ? 1 : 0);
}

export const EMPTY_FILTERS: Filters = { discipline: [], level: [], region: "", from: "", to: "", view: "list" };
