import { describe, expect, it } from "vitest";
import { backfillCoordinates } from "../src/pipeline/geocode.ts";
import { PoliteClient } from "../src/pipeline/http.ts";
import { createTestDb } from "./d1shim.ts";

function geoClient(handler: (q: string) => Response) {
  const asked: string[] = [];
  const http = new PoliteClient({
    userAgent: "test",
    minIntervalMs: 0,
    fetcher: async (url) => {
      const u = new URL(url);
      if (u.pathname === "/robots.txt") return new Response("", { status: 404 });
      asked.push(u.searchParams.get("q")!);
      return handler(u.searchParams.get("q")!);
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
        ? Response.json([{ lat: "50.77", lon: "15.06", address: { state: "Liberecký kraj" } }])
        : q === "Chyba"
          ? new Response("blocked", { status: 403 })
          : Response.json([]),
    );

    const report = await backfillCoordinates(db, http, 40);
    expect(report).toEqual({ checked: 4, geocoded: 2, errors: ["Error: Nominatim 403 for 'Chyba, CZ'"] });
    expect(asked.sort()).toEqual(["Chyba", "Liberec", "Nikde"]);
    const { results } = await db.prepare("SELECT name, lat, lng, region FROM events ORDER BY name").all();
    expect(results.slice(0, 2)).toEqual([
      { name: "A", lat: 50.77, lng: 15.06, region: "Liberecký kraj" },
      { name: "B", lat: 50.77, lng: 15.06, region: "Liberecký kraj" },
    ]);
  });
});
