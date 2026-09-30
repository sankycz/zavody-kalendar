import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { processExtraction } from "../src/pipeline/run.ts";
import { upsertEvents } from "../src/pipeline/upsert.ts";
import { createTestDb } from "./d1shim.ts";

// Real model output stored by `npm run fixtures:extract` as
// fixtures/<provider>/<source-id>.extraction.json. No API calls here.
interface RealExtraction {
  source_id: string;
  season: number;
  events: unknown[];
}

// Same priorities as the sources table after migrations/0004 (read from the DB below).
const PRIORITY: Record<string, number> = Object.fromEntries(
  (createTestDb().raw.prepare("SELECT id, priority FROM sources").all() as { id: string; priority: number }[]).map((r) => [
    r.id,
    r.priority,
  ]),
);

const fixturesDir = join(import.meta.dirname, "..", "fixtures");
const real: { provider: string; data: RealExtraction }[] = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) =>
    readdirSync(join(fixturesDir, d.name))
      .filter((f) => f.endsWith(".extraction.json"))
      .map((f) => ({
        provider: d.name,
        data: JSON.parse(readFileSync(join(fixturesDir, d.name, f), "utf8")) as RealExtraction,
      })),
  )
  .sort((a, b) => (PRIORITY[a.data.source_id] ?? 99) - (PRIORITY[b.data.source_id] ?? 99));

describe.skipIf(real.length === 0)("real extraction fixtures", () => {
  it.each(real.map((r) => [r.data.source_id, r] as const))("%s normalizes to valid ISO events", (_id, r) => {
    const batch = processExtraction(r.data.events, r.data.season);
    expect(batch.events.length).toBeGreaterThan(0);
    for (const e of batch.events) {
      expect(e.date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (e.date_to) expect(e.date_to >= e.date_from).toBe(true);
    }
  });

  it("ingest in priority order links shared races instead of duplicating them", async () => {
    const { d1, raw } = createTestDb();
    let total = 0;
    for (const r of real) {
      const batch = processExtraction(r.data.events, r.data.season);
      total += batch.events.length;
      const src = { id: r.data.source_id, provider: r.provider, url: `https://${r.provider}.example/`, priority: PRIORITY[r.data.source_id] ?? 99 };
      await upsertEvents(d1, src, batch.events, new Map());
    }
    const events = (raw.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n;
    expect(events).toBeGreaterThan(0);
    expect(events).toBeLessThanOrEqual(total);
    if (real.length > 1) expect(events).toBeLessThan(total);
  });

  it("skips the typos Autokaleidoskop really has, keeps the rest", () => {
    const k = real.find((r) => r.data.source_id === "autokaleidoskop-2026");
    if (!k) return;
    const errors = processExtraction(k.data.events, 2026).invalid.map((i) => i.error);
    expect(errors.filter((e) => e.startsWith("invalid date"))).toEqual(["invalid date_from '1ý.'", "invalid date_from '???'"]);
    // e.g. "26. – 27.9. ???" (Edda Cup without a place) is not written at all.
    expect(errors.filter((e) => e === "missing location_name")).toHaveLength(6);
  });

  it("merges one race written with a shorter and a longer place name, keeps the longer one", async () => {
    const { d1, raw } = createTestDb();
    for (const r of real) {
      const src = { id: r.data.source_id, provider: r.provider, url: `https://${r.provider}.example/`, priority: PRIORITY[r.data.source_id]! };
      await upsertEvents(d1, src, processExtraction(r.data.events, r.data.season).events, new Map());
    }
    const places = raw
      .prepare("SELECT location_name l, dedupe_key k FROM events WHERE location_name LIKE 'Bečov%' OR location_name LIKE 'Náměšť%'")
      .all();
    expect(places).toEqual([
      { l: "Náměšť nad Oslavou", k: "namest-nad-oslavou|2026-05-01|vrch" },
      { l: "Bečov nad Teplou", k: "becov-nad-teplou|2026-09-04|vrch" },
    ]);
  });

  it("links Edda Cup rounds listed a day apart by Edda and Autokaleidoskop, Edda's own dates win", async () => {
    const pick = real.filter((r) => r.data.source_id === "autokaleidoskop-2026" || r.data.source_id === "edda-2026");
    if (pick.length < 2) return;
    const { d1, raw } = createTestDb();
    for (const r of pick) {
      const src = { id: r.data.source_id, provider: r.provider, url: `https://${r.provider}.example/`, priority: PRIORITY[r.data.source_id]! };
      await upsertEvents(d1, src, processExtraction(r.data.events, r.data.season).events, new Map());
    }
    const linked = raw
      .prepare("SELECT e.dedupe_key k FROM events e WHERE (SELECT count(*) FROM event_sources s WHERE s.event_id = e.id) = 2 ORDER BY 1")
      .all()
      .map((r) => (r as { k: string }).k);
    // Edda 27.–28.3. vs Autokaleidoskop 28.3., Edda 01.–03.05. vs 2.–3.5. etc.
    expect(linked).toEqual(
      expect.arrayContaining(["most|2026-03-27|vrch", "makarov|2026-05-01|vrch", "kdyne|2026-05-22|vrch", "milovice|2026-10-09|vrch"]),
    );
  });

  it("stores no rider lists from Edda Cup", () => {
    const edda = join(fixturesDir, "edda", "edda-2026.extraction.json");
    if (!existsSync(edda)) return;
    expect(readFileSync(edda, "utf8")).not.toMatch(/trate\/jezdci/);
  });
});
