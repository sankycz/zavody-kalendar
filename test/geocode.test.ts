import { describe, expect, it } from "vitest";
import { backfillCoordinates, czechRegion, geocode } from "../src/pipeline/geocode.ts";
import { PoliteClient } from "../src/pipeline/http.ts";
import { createTestDb } from "./d1shim.ts";

function geoClient(handler: (q: string, country: string | null) => Response) {
  const asked: string[] = [];
  const http = new PoliteClient({
    userAgent: "test",
    minIntervalMs: 0,
    fetcher: async (url) => {
      const u = new URL(url);
      if (u.pathname === "/robots.txt") return new Response("", { status: 404 });
      expect(u.host).toBe("geocoding-api.open-meteo.com");
      const country = u.searchParams.get("countryCode");
      asked.push(`${u.searchParams.get("name")}${country ? `/${country}` : ""}`);
      return handler(u.searchParams.get("name")!, country);
    },
  });
  return { http, asked };
}

async function insert(db: D1Database, name: string, place: string | null, lat: number | null = null) {
  await db
    .prepare(
      "INSERT INTO events (name, date_from, discipline, level, location_name, country, lat, lng, dedupe_key) VALUES (?, '2026-05-01', 'rally', 'volny', ?, 'CZ', ?, ?, ?)",
    )
    .bind(name, place, lat, lat, `${name}|2026-05-01|rally`)
    .run();
}

describe("backfillCoordinates", () => {
  it("geocodes events without coordinates, once per place, and reports failures", async () => {
    const { d1: db } = createTestDb();
    await insert(db, "A", "Liberec");
    await insert(db, "B", "Liberec");
    await insert(db, "C", "Nikde");
    await insert(db, "D", "Brno", 49.2);
    await insert(db, "E", null);
    await insert(db, "F", "Chyba");
    const { http, asked } = geoClient((q) =>
      q === "Liberec"
        ? Response.json({ results: [{ latitude: 50.77, longitude: 15.06, country_code: "CZ", admin1: "Liberecký kraj" }] })
        : q === "Chyba"
          ? new Response("blocked", { status: 403 })
          : Response.json({}),
    );

    const report = await backfillCoordinates(db, http, 40);
    expect(report).toEqual({ checked: 4, geocoded: 2, errors: ["Error: Open-Meteo 403 for 'Chyba'"] });
    expect(asked.sort()).toEqual(["Chyba/CZ", "Liberec/CZ", "Nikde", "Nikde/CZ"]);
    const { results } = await db.prepare("SELECT name, lat, lng, region FROM events ORDER BY name").all();
    expect(results.slice(0, 2)).toEqual([
      { name: "A", lat: 50.77, lng: 15.06, region: "Liberecký kraj" },
      { name: "B", lat: 50.77, lng: 15.06, region: "Liberecký kraj" },
    ]);
  });

});

describe("geocode", () => {
  it("looks a place up in neighboring countries when the given country has no match", async () => {
    const { d1: db } = createTestDb();
    const { http, asked } = geoClient((_q, country) =>
      Response.json(
        country
          ? {}
          : {
              results: [
                { latitude: 40, longitude: -80, country_code: "US" },
                { latitude: 50.58, longitude: 13.0, country_code: "DE", admin1: "Sasko" },
              ],
            },
      ),
    );
    expect(await geocode(db, http, "Annaberg-Buchholz", "CZ")).toEqual({ lat: 50.58, lng: 13.0, region: "Sasko", country: "DE" });
    expect(asked).toEqual(["Annaberg-Buchholz/CZ", "Annaberg-Buchholz"]);
    // Cached: no further request.
    expect(await geocode(db, http, "Annaberg-Buchholz", "CZ")).toEqual({ lat: 50.58, lng: 13.0, region: "Sasko", country: "DE" });
    expect(asked).toHaveLength(2);
  });
});

describe("czechRegion", () => {
  it.each([
    ["Karlovarský", "CZ", "Karlovarský kraj"],
    ["Plzeňský kraj", "CZ", "Plzeňský kraj"],
    ["Vysočina", "CZ", "Kraj Vysočina"],
    ["Hlavní město Praha", "CZ", "Hlavní město Praha"],
    ["Sasko", "DE", "Sasko"],
    [null, "CZ", null],
  ])("%s (%s) -> %s", (admin1, cc, want) => {
    expect(czechRegion(admin1, cc)).toBe(want);
  });
});
