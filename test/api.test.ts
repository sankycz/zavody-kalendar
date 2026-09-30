import { describe, expect, it } from "vitest";
import { EventsQuery, handleApi, listEvents, todayInPrague } from "../src/api.ts";
import { processExtraction } from "../src/pipeline/run.ts";
import { upsertEvents } from "../src/pipeline/upsert.ts";
import { createTestDb } from "./d1shim.ts";

const item = (name: string, date_from: string, date_to: string | null, discipline: string, level: string, loc: string) => ({
  name, date_from, date_to, discipline, level, location_name: loc, series: null, region: null, country: "CZ",
  organizer: null, website_url: null, description: null, status: "planned", raw_excerpt: name,
});

async function seeded() {
  const { d1, raw } = createTestDb();
  const { events } = processExtraction(
    [
      item("Past", "2026-03-01", null, "slalom", "regionalni", "Brno"),
      item("Running now", "2026-05-01", "2026-05-03", "rally", "mcr", "Klatovy"),
      item("Hill", "2026-06-06", null, "vrch", "mcr", "Šternberk"),
      item("Cross", "2026-07-10", null, "autocross", "volny", "Přerov"),
    ],
    2026,
  );
  await upsertEvents(d1, { id: "autoklub-cal-pdf-2026", provider: "autoklub-cal", url: "https://x.example/", priority: 10 }, events, new Map());
  return { d1, raw };
}

describe("listEvents", () => {
  it("returns upcoming and running events sorted by date, with source count", async () => {
    const { d1 } = await seeded();
    const r = await listEvents(d1, {}, "2026-05-02");
    expect(r.events.map((e) => e.name)).toEqual(["Running now", "Hill", "Cross"]);
    expect(r.events[0]!.source_count).toBe(1);
  });

  it("filters by discipline, level and date range", async () => {
    const { d1 } = await seeded();
    const q = EventsQuery.parse({ discipline: "vrch,autocross", level: "mcr", to: "2026-12-31" });
    expect((await listEvents(d1, q, "2026-01-01")).events.map((e) => e.name)).toEqual(["Hill"]);
  });

  it("reports last ingest time", async () => {
    const { d1, raw } = await seeded();
    expect((await listEvents(d1, {}, "2026-01-01")).last_ingest_at).toBeNull();
    raw.exec("UPDATE sources SET last_fetched_at = '2026-09-28T03:17:00.000Z' WHERE id = 'edda-2026'");
    expect((await listEvents(d1, {}, "2026-01-01")).last_ingest_at).toBe("2026-09-28T03:17:00.000Z");
  });
});

describe("handleApi", () => {
  it("rejects invalid filters with 400", async () => {
    const { d1 } = await seeded();
    const res = await handleApi(new Request("https://x/api/events?discipline=motokros"), d1);
    expect(res.status).toBe(400);
  });

  it("is read-only", async () => {
    const { d1 } = await seeded();
    expect((await handleApi(new Request("https://x/api/events", { method: "POST" }), d1)).status).toBe(405);
  });
});

describe("todayInPrague", () => {
  it("uses Czech time, not UTC", () => {
    expect(todayInPrague(new Date("2026-05-01T22:30:00Z"))).toBe("2026-05-02");
  });
});
