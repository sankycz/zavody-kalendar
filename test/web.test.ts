import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, activeFilterCount, eventsApiUrl, listHref, parseFilters, rememberedQuery, seasonOf, seasonRange } from "../web/src/filters.ts";
import { distanceKm, formatDistance } from "../web/src/distance.ts";

describe("season switch", () => {
  it("recognizes a whole season and doesn't count it as a filter", () => {
    const f = { ...EMPTY_FILTERS, ...seasonRange(2027) };
    expect(seasonOf(f)).toBe(2027);
    expect(activeFilterCount(f)).toBe(0);
    expect(activeFilterCount({ ...f, discipline: ["rally"] })).toBe(1);
    expect(seasonOf({ from: "2026-01-01", to: "" })).toBe(2026);
    expect(seasonOf({ from: "2026-03-01", to: "2026-12-31" })).toBeNull();
    expect(activeFilterCount({ ...EMPTY_FILTERS, from: "2026-03-01" })).toBe(1);
  });

  it("keeps the near-me sort in the URL, not the position", () => {
    const href = listHref({ ...EMPTY_FILTERS, sort: "near", view: "map" });
    expect(href).toBe("/?view=map&sort=near");
    expect(parseFilters(new URL(`https://x.cz${href}`).searchParams)).toMatchObject({ sort: "near", view: "map" });
  });
});

describe("distance", () => {
  it("measures Prague – Brno and formats it", () => {
    const km = distanceKm({ lat: 50.08, lng: 14.42 }, { lat: 49.2, lng: 16.61 });
    expect(km).toBeGreaterThan(180);
    expect(km).toBeLessThan(190);
    expect(formatDistance(km)).toMatch(/^18\d km$/);
    expect(formatDistance(0.83)).toBe("850 m");
  });
});

describe("search in the URL", () => {
  it("keeps an open empty bar on the page, sends only words to the API", () => {
    const open = parseFilters(new URLSearchParams("q="));
    expect(open.q).toBe("");
    expect(listHref(open)).toBe("/?q=");
    expect(eventsApiUrl(open)).toBe("/api/events");
    expect(eventsApiUrl({ ...EMPTY_FILTERS, q: " Miriquidi " })).toBe("/api/events?q=Miriquidi");
    expect(parseFilters(new URLSearchParams("")).q).toBeNull();
  });
});

describe("swiping between races", () => {
  it("moves along the order of the list", async () => {
    const { neighboursIn } = await import("../web/src/raceOrder.ts");
    const races = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
    expect(neighboursIn(races, "b")).toEqual({ prev: races[0], next: races[2] });
    expect(neighboursIn(races, "a")).toEqual({ prev: null, next: races[1] });
    expect(neighboursIn(races, "x")).toEqual({ prev: null, next: null });
  });
});

describe("kept in the browser", () => {
  it("favourites are a page flag, not an API filter", () => {
    const f = parseFilters(new URLSearchParams("fav=1&discipline=rally"));
    expect(f.fav).toBe(true);
    expect(listHref(f)).toBe("/?discipline=rally&fav=1");
    expect(eventsApiUrl(f)).toBe("/api/events?discipline=rally");
    expect(activeFilterCount(f)).toBe(1);
  });

  it("remembers disciplines, levels, region, view and favourites – not dates, search or near me", () => {
    const f = { ...EMPTY_FILTERS, discipline: ["vrch" as const], region: "Zlínský kraj", view: "map" as const, fav: true, from: "2026-10-01", q: "Ecce", sort: "near" as const };
    expect(rememberedQuery(f)).toBe("discipline=vrch&region=Zl%C3%ADnsk%C3%BD+kraj&view=map&fav=1");
    expect(rememberedQuery(EMPTY_FILTERS)).toBe("");
  });
});
