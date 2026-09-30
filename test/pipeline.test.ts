import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dedupeKey, mergeEvent } from "../src/pipeline/dedupe.ts";
import { processExtraction } from "../src/pipeline/run.ts";
import { upsertEvents } from "../src/pipeline/upsert.ts";
import type { NormalizedEvent } from "../src/pipeline/schema.ts";
import { createTestDb } from "./d1shim.ts";

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "fixtures", "autoklub-cal", "extraction.sample.json"), "utf8"),
) as { season: number; events: unknown[] };

const AUTOKLUB = { id: "autoklub-cal-pdf-2026", provider: "autoklub-cal", url: "https://autoklub.example/cal.pdf", priority: 10 };
const KALEIDO = { id: "autokaleidoskop-2026", provider: "autokaleidoskop", url: "https://kaleido.example/", priority: 50 };

describe("dedupe", () => {
  it("key ignores case and diacritics", () => {
    expect(dedupeKey("Český Krumlov", "2026-05-01", "rally")).toBe(dedupeKey("cesky  KRUMLOV", "2026-05-01", "rally"));
  });

  it("merge: winning source overwrites, losing source only fills gaps", () => {
    const existing = { name: "A", date_to: null, series: "S", level: "mcr", location_name: "X", region: null, country: "CZ", organizer: null, website_url: null, description: null, status: "planned" } as const;
    const incoming = { ...existing, name: "B", region: "Kraj", organizer: "Klub" };
    expect(mergeEvent(existing, incoming, true)).toMatchObject({ name: "B", region: "Kraj", organizer: "Klub" });
    expect(mergeEvent(existing, incoming, false)).toMatchObject({ name: "A", region: "Kraj", organizer: "Klub" });
  });
});

describe("processExtraction on autoklub fixture", () => {
  const batch = processExtraction(fixture.events, fixture.season);

  it("skips invalid items without failing the batch", () => {
    expect(batch.invalid.map((i) => i.error)).toEqual([
      "invalid date_from '31.4.2026'",
      "invalid date_from 'květen?'",
      "date_to 2026-09-19 before date_from 2026-09-20",
      "missing name",
    ]);
  });

  it("collapses the duplicate Klatovy entry and fills its missing region", () => {
    const klatovy = batch.events.filter((e) => e.dedupe_key === "klatovy|2026-05-22|rally");
    expect(klatovy).toHaveLength(1);
    expect(klatovy[0]).toMatchObject({
      date_to: "2026-05-23",
      organizer: "AK Test v AČR",
      region: "Plzeňský kraj",
      website_url: "https://www.rallye-test.example/",
    });
  });

  it("normalizes dates, countries and locations", () => {
    const byName = new Map(batch.events.map((e) => [e.name, e]));
    expect(byName.get("Test Rallysprint Kopná")).toMatchObject({ date_from: "2026-05-16", country: "CZ", level: "pohar" });
    expect(byName.get("Testovací vrch v Rakousku")).toMatchObject({ country: "AT" });
    expect(byName.get("Testovací autokros Přerov")).toMatchObject({ location_name: "Přerov", status: "cancelled" });
    expect(batch.events).toHaveLength(5);
  });
});

describe("upsert into D1 schema", () => {
  const events = processExtraction(fixture.events, fixture.season).events;

  it("inserts events and source links, idempotent on re-run", async () => {
    const { d1, raw } = createTestDb();
    const geo = new Map([["klatovy|2026-05-22|rally", { lat: 49.39, lng: 13.29, region: "Plzeňský kraj" }]]);

    expect(await upsertEvents(d1, AUTOKLUB, events, geo)).toEqual({ inserted: 5, updated: 0 });
    expect(await upsertEvents(d1, AUTOKLUB, events, geo)).toEqual({ inserted: 0, updated: 5 });

    expect(raw.prepare("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 5 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM event_sources").get()).toEqual({ n: 5 });
    expect(raw.prepare("SELECT lat, lng FROM events WHERE dedupe_key = 'klatovy|2026-05-22|rally'").get()).toEqual({
      lat: 49.39,
      lng: 13.29,
    });
  });

  it("same race from a lower-priority source: one event, two sources, Autoklub values kept", async () => {
    const { d1, raw } = createTestDb();
    await upsertEvents(d1, AUTOKLUB, events, new Map());

    const klatovy = events.find((e) => e.dedupe_key === "klatovy|2026-05-22|rally")!;
    const fromKaleido: NormalizedEvent = { ...klatovy, name: "Rally Klatovy (Kaleido)", description: "doplněno z Autokaleidoskopu" };
    expect(await upsertEvents(d1, KALEIDO, [fromKaleido], new Map())).toEqual({ inserted: 0, updated: 1 });

    const row = raw.prepare("SELECT id, name, description FROM events WHERE dedupe_key = ?").get(klatovy.dedupe_key) as {
      id: string; name: string; description: string | null;
    };
    expect(row.name).toBe("Testovací Rallye Klatovy");
    expect(row.description).toBe("druhý výskyt stejného závodu v jiném oddílu PDF");
    expect(raw.prepare("SELECT source_id FROM event_sources WHERE event_id = ? ORDER BY source_id").all(row.id)).toEqual([
      { source_id: "autoklub-cal-pdf-2026" },
      { source_id: "autokaleidoskop-2026" },
    ].sort((a, b) => a.source_id.localeCompare(b.source_id)));
  });

  it("Autoklub arriving after a lower-priority source overwrites its values", async () => {
    const { d1, raw } = createTestDb();
    const klatovy = events.find((e) => e.dedupe_key === "klatovy|2026-05-22|rally")!;
    await upsertEvents(d1, KALEIDO, [{ ...klatovy, name: "Kaleido name" }], new Map());
    await upsertEvents(d1, AUTOKLUB, [klatovy], new Map());
    expect(raw.prepare("SELECT name FROM events").get()).toEqual({ name: "Testovací Rallye Klatovy" });
  });

  it("an event missing from a later run is kept", async () => {
    const { d1, raw } = createTestDb();
    await upsertEvents(d1, AUTOKLUB, events, new Map());
    await upsertEvents(d1, AUTOKLUB, events.slice(0, 2), new Map());
    expect(raw.prepare("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 5 });
  });
});
