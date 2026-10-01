import { describe, expect, it } from "vitest";
import { statedIn } from "../src/pipeline/dedupe.ts";
import { processExtraction } from "../src/pipeline/run.ts";
import { mergeEvents, upsertEvents } from "../src/pipeline/upsert.ts";
import { createTestDb } from "./d1shim.ts";

// The real duplicates of 2026: ČMPR lists no places (the model guessed them
// from the name), Autokaleidoskop names them; Autokaleidoskop still has the
// preliminary date of Rallye Železné hory.
const CMPR = { id: "cmpr-2026", provider: "cmpr", url: "https://cmpr.cz/souteze-poharu/", priority: 22 };
const KALEIDO = { id: "autokaleidoskop-2026", provider: "autokaleidoskop", url: "https://www.autokaleidoskop.cz/", priority: 70 };

const rally = (name: string, from: string, to: string, place: string, excerpt: string, extra: object = {}) => ({
  name, date_from: from, date_to: to, discipline: "rally", level: "pohar", location_name: place, country: "CZ",
  status: "planned", raw_excerpt: excerpt, ...extra,
});
const events = (items: unknown[]) => processExtraction(items, 2026).events;

describe("statedIn", () => {
  it.each([
    ["Železný Brod", "6. - 7.3. Rallye Jizera, Žel.Brods", true],
    ["Kyjov", "11, - 12.9. Slovácká Rallye, Kyjov", true],
    ["Liberec", "6.-7.3. 2026 Rallye Jizera (https://www.rallyejizera.cz/2026/cs/)", false],
    ["Uherské Hradiště", "11.-12.9. 2026 Slovácká rally (https://www.slovacka-rally.cz/)", false],
    ["Kostelec nad Orlicí", "Podorlická rally, Kostelec n. Orl.", true],
    ["Kyjov", null, false],
  ])("%s in %s → %s", (place, excerpt, want) => {
    expect(statedIn(place, excerpt)).toBe(want);
  });
});

describe("the same race under two places", () => {
  it("merges by name and keeps the place a source names over a guessed one", async () => {
    const { d1, raw } = createTestDb();
    raw.exec("INSERT INTO locations (query, lat, lng, region, country, found) VALUES ('x', 0, 0, NULL, 'CZ', 1)");
    await upsertEvents(d1, CMPR, events([
      rally("Rallye Jizera", "2026-03-06", "2026-03-07", "Liberec", "6.-7.3. 2026 Rallye Jizera (https://www.rallyejizera.cz/2026/cs/)", {
        website_url: "https://www.rallyejizera.cz/2026/cs/", series: "Českomoravský pohár rallye",
      }),
      rally("Rallye Králíky", "2026-04-17", "2026-04-18", "Králíky", "17.-18.4. 2026 Rallye Králíky"),
    ]), new Map([["liberec|2026-03-06|rally", { lat: 50.77, lng: 15.06, region: "Liberecký kraj", country: "CZ" }]]));
    const geo = new Map([["zelezny-brod|2026-03-06|rally", { lat: 50.64, lng: 15.25, region: "Liberecký kraj", country: "CZ" }]]);
    const stats = await upsertEvents(d1, KALEIDO, events([
      rally("Rallye Jizera", "2026-03-06", "2026-03-07", "Železný Brod", "6. - 7.3. Rallye Jizera, Žel.Brods"),
      // Same weekend, another race: not merged.
      rally("Rallye Hořovice", "2026-04-17", "2026-04-18", "Hořovice", "17.4. Rallye Hořovice"),
    ]), geo);
    expect(stats).toEqual({ inserted: 1, updated: 1 });
    expect(raw.prepare("SELECT name, location_name, lat, website_url, dedupe_key FROM events WHERE name = 'Rallye Jizera'").all()).toEqual([
      { name: "Rallye Jizera", location_name: "Železný Brod", lat: 50.64, website_url: "https://www.rallyejizera.cz/2026/cs/", dedupe_key: "zelezny-brod|2026-03-06|rally" },
    ]);

    // ČMPR's next run still says (guessed) Liberec: same event through the alias, place stays.
    await upsertEvents(d1, CMPR, events([
      rally("Rallye Jizera", "2026-03-06", "2026-03-07", "Liberec", "6.-7.3. 2026 Rallye Jizera (https://www.rallyejizera.cz/2026/cs/)"),
    ]), new Map());
    expect(raw.prepare("SELECT location_name FROM events WHERE name = 'Rallye Jizera'").all()).toEqual([{ location_name: "Železný Brod" }]);
    expect(raw.prepare("SELECT count(*) AS n FROM events").get()).toEqual({ n: 3 });
  });
});

describe("mergeEvents", () => {
  it("merges a duplicate with a stale date and keeps it merged on the next ingest", async () => {
    const { d1, raw } = createTestDb();
    await upsertEvents(d1, CMPR, events([
      rally("Rallye Železné hory", "2026-07-17", "2026-07-18", "Chrudim", "17.-18.7. 2026 Rallye Železné hory", { website_url: "https://www.rallyezeleznehory.cz/" }),
    ]), new Map());
    const stale = events([rally("Rallye Železné hory", "2026-07-31", "2026-08-01", "Chrudim", "31.7. - 1.8. Rallye Železné hory", { organizer: "AMK Chrudim" })]);
    await upsertEvents(d1, KALEIDO, stale, new Map());
    const ids = raw.prepare("SELECT id, date_from FROM events ORDER BY date_from").all() as { id: string; date_from: string }[];
    expect(ids).toHaveLength(2);

    expect(await mergeEvents(d1, ids[0]!.id, ids[1]!.id)).toBe(true);
    expect(raw.prepare("SELECT date_from, organizer, website_url FROM events").all()).toEqual([
      { date_from: "2026-07-17", organizer: "AMK Chrudim", website_url: "https://www.rallyezeleznehory.cz/" },
    ]);
    expect(raw.prepare("SELECT source_id FROM event_sources ORDER BY source_id").all()).toEqual([
      { source_id: "autokaleidoskop-2026" },
      { source_id: "cmpr-2026" },
    ]);

    // Autokaleidoskop still lists 31. 7.: it updates the merged race, no duplicate comes back.
    expect(await upsertEvents(d1, KALEIDO, stale, new Map())).toEqual({ inserted: 0, updated: 1 });
    expect(raw.prepare("SELECT date_from FROM events").all()).toEqual([{ date_from: "2026-07-17" }]);
  });
});
