import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { processExtraction } from "../src/pipeline/run.ts";
import { upsertEvents } from "../src/pipeline/upsert.ts";
import type { NormalizedEvent } from "../src/pipeline/schema.ts";
import { createTestDb } from "./d1shim.ts";

function load(provider: string): { season: number; events: unknown[] } {
  return JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", provider, "extraction.sample.json"), "utf8"));
}

// Same ids / providers / priorities as the seed in migrations/0001.
const SOURCES = {
  autoklub: { id: "autoklub-cal-pdf-2026", provider: "autoklub-cal", url: "https://autoklub.example/cal.pdf", priority: 10 },
  kaleido: { id: "autokaleidoskop-2026", provider: "autokaleidoskop", url: "https://kaleido.example/", priority: 50 },
  edda: { id: "edda-2026", provider: "edda", url: "http://edda.example/trate", priority: 60 },
} as const;

const batches = {
  autoklub: processExtraction(load("autoklub-cal").events, 2026),
  kaleido: processExtraction(load("autokaleidoskop").events, 2026),
  edda: processExtraction(load("edda").events, 2026),
};

type Name = keyof typeof SOURCES;

async function ingest(order: Name[]) {
  const { d1, raw } = createTestDb();
  const stats: Record<string, unknown> = {};
  for (const n of order) stats[n] = await upsertEvents(d1, SOURCES[n], batches[n].events, new Map());
  const rows = raw
    .prepare(
      `SELECT e.dedupe_key, e.name, e.date_from, e.date_to, e.level,
              (SELECT group_concat(source_id, ',') FROM (SELECT source_id FROM event_sources WHERE event_id = e.id ORDER BY source_id)) AS sources
         FROM events e ORDER BY e.dedupe_key`,
    )
    .all() as { dedupe_key: string; name: string; date_from: string; date_to: string | null; level: string; sources: string }[];
  return { stats, rows, byKey: new Map(rows.map((r) => [r.dedupe_key, r])) };
}

describe("autokaleidoskop + edda fixtures", () => {
  it("skip invalid items (date typo, non-car discipline)", () => {
    expect(batches.kaleido.invalid.map((i) => i.error)).toEqual([
      "invalid date_from '32.5.2026'",
      "unknown discipline 'motokáry'",
    ]);
    expect(batches.edda.invalid).toEqual([]);
  });

  it("keep two slaloms at one place on consecutive days apart", () => {
    const vm = batches.kaleido.events.filter((e) => e.location_name === "Vysoké Mýto").map((e) => e.dedupe_key);
    expect(vm.sort()).toEqual(["vysoke-myto|2026-06-13|slalom", "vysoke-myto|2026-06-14|slalom"]);
  });
});

describe("dedupe across Autoklub ČR, Autokaleidoskop and Edda Cup", () => {
  it("priority order: shared races get linked, Autoklub values stay", async () => {
    const { stats, rows, byKey } = await ingest(["autoklub", "kaleido", "edda"]);
    expect(stats).toEqual({
      autoklub: { inserted: 5, updated: 0 },
      kaleido: { inserted: 3, updated: 2 },
      edda: { inserted: 1, updated: 2 },
    });
    expect(rows).toHaveLength(9);

    // Kaleido lists Klatovy one day later -> near match, Autoklub dates kept.
    expect(byKey.get("klatovy|2026-05-22|rally")).toMatchObject({
      name: "Testovací Rallye Klatovy",
      date_to: "2026-05-23",
      sources: "autokaleidoskop-2026,autoklub-cal-pdf-2026",
    });
    // Edda Cup round that is also MČR: one event, level from Autoklub.
    expect(byKey.get("sternberk|2026-06-06|vrch")).toMatchObject({
      level: "mcr",
      sources: "autoklub-cal-pdf-2026,edda-2026",
    });
    expect(byKey.get("rechberg|2026-07-11|vrch")).toMatchObject({
      date_to: "2026-07-12",
      sources: "autoklub-cal-pdf-2026,edda-2026",
    });
  });

  it("reverse order ends in the same events, Autoklub still wins incl. dates", async () => {
    const forward = await ingest(["autoklub", "kaleido", "edda"]);
    const reverse = await ingest(["edda", "kaleido", "autoklub"]);
    expect(reverse.rows.map((r) => [r.dedupe_key, r.sources])).toEqual(forward.rows.map((r) => [r.dedupe_key, r.sources]));
    expect(reverse.byKey.get("klatovy|2026-05-22|rally")).toMatchObject({ name: "Testovací Rallye Klatovy", date_to: "2026-05-23" });
    expect(reverse.byKey.get("rechberg|2026-07-11|vrch")).toMatchObject({ name: "Testovací vrch v Rakousku", level: "mcr" });
  });

  it("near match never swallows a race that another item matches exactly", async () => {
    const { d1, raw } = createTestDb();
    const vm13: NormalizedEvent = {
      ...batches.kaleido.events.find((e) => e.dedupe_key === "vysoke-myto|2026-06-13|slalom")!,
      name: "Autoslalom Vysoké Mýto (AČR)",
    };
    await upsertEvents(d1, SOURCES.autoklub, [vm13], new Map());
    // Kaleido batch lists the 14th before the 13th.
    await upsertEvents(d1, SOURCES.kaleido, batches.kaleido.events, new Map());
    expect(
      raw.prepare("SELECT date_from FROM events WHERE location_name = 'Vysoké Mýto' ORDER BY date_from").all(),
    ).toEqual([{ date_from: "2026-06-13" }, { date_from: "2026-06-14" }]);
  });

  it("does not merge races two or more days apart", async () => {
    const { d1, raw } = createTestDb();
    const base = batches.kaleido.events.find((e) => e.location_name === "Příbram")!;
    await upsertEvents(d1, SOURCES.autoklub, [base], new Map());
    const later = { ...base, date_from: "2026-04-20", date_to: null, dedupe_key: "pribram|2026-04-20|rally" };
    expect(await upsertEvents(d1, SOURCES.kaleido, [later], new Map())).toEqual({ inserted: 1, updated: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 2 });
  });
});
