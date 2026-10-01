import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getEvent } from "../src/api.ts";
import { nameWords, sameRaceName } from "../src/pipeline/eventPage.ts";
import { EVENT_PAGE_NOTE, type MessagesClient } from "../src/pipeline/extract.ts";
import { PoliteClient } from "../src/pipeline/http.ts";
import { claudeModel } from "../src/pipeline/llm.ts";
import { normalizeLinks } from "../src/pipeline/normalize.ts";
import { processExtraction, runAll } from "../src/pipeline/run.ts";
import { upsertEvents } from "../src/pipeline/upsert.ts";
import { createTestDb } from "./d1shim.ts";

/** Real page of KBS Sedliště (XI. Podbrdské setkání legend), saved via Apify 1. 10. 2026. */
const DIR = join(import.meta.dirname, "..", "fixtures", "kbssped");
const PAGE = readFileSync(join(DIR, "kbssped-2026.html"), "utf8");
const EXTRACTION = JSON.parse(readFileSync(join(DIR, "kbssped-2026.extraction.json"), "utf8")) as { events: unknown[] };
const URL = "https://www.kbssped.cz/?page_id=34";

describe("race names", () => {
  it("drop ordinals, years and diacritics", () => {
    expect([...nameWords("XI. Podbrdské setkání legend 2026")]).toEqual(["podbrdske", "setkani", "legend"]);
  });

  it.each([
    ["Podbrdské setkání Legend", "XI. Podbrdské setkání legend 2026", true],
    ["Podbrdské setkání Legend", "Podbrdská Rallye Legend", false],
    ["Rally Vsetín", "XX. Partr Rally Vsetín", true],
    ["Rally Vsetín", "Rallye Jizera", false],
    ["Autoslalom Hodonín", "Autoslalom Třinec", false],
    ["Legend", "XI. Podbrdské setkání legend", false],
  ])("%s ~ %s → %s", (a, b, want) => {
    expect(sameRaceName(a, b)).toBe(want);
  });
});

describe("normalizeLinks", () => {
  it("keeps documents for spectators, never lists of people or entry forms", () => {
    const links = normalizeLinks([
      { label: "Časový harmonogram", url: "https://x.cz/Harmonogram_2026.png", kind: "harmonogram" },
      { label: "STARTOVNÍ LISTINA", url: "https://x.cz/Startovni-listina.pdf", kind: "jine" },
      { label: "Seznam přijatých posádek", url: "https://x.cz/Seznam-prihlasenych-posadek.pdf", kind: "jine" },
      { label: "PDF", url: "https://x.cz/prihlaska-2026.pdf", kind: "jine" },
      { label: "Výsledky", url: "https://x.cz/vysledky", kind: "jine" },
      { label: "Mapa", url: "www.x.cz/mapa.png", kind: "map" },
      { label: "Mapa znovu", url: "https://www.x.cz/mapa.png", kind: "mapa" },
      { label: "", url: "https://x.cz/a.pdf", kind: "jine" },
      { label: "Rozbité", url: "javascript:void(0)", kind: "jine" },
    ]);
    expect(links).toEqual([
      { label: "Časový harmonogram", url: "https://x.cz/Harmonogram_2026.png", kind: "harmonogram" },
      { label: "Mapa", url: "https://www.x.cz/mapa.png", kind: "jine" },
    ]);
    expect(normalizeLinks(undefined)).toEqual([]);
  });

  it("travel with a calendar item into the event", async () => {
    const { d1, raw } = createTestDb();
    const { events } = processExtraction(
      [
        {
          name: "Rally X", date_from: "2026-06-06", date_to: null, discipline: "rally", level: "volny", location_name: "Klatovy",
          country: "CZ", status: "planned", raw_excerpt: "Rally X",
          links: [{ label: "Mapa RZ", url: "https://rally-x.cz/mapa.pdf", kind: "mapa" }],
        },
      ],
      2026,
    );
    await upsertEvents(d1, { id: "cmpr-2026", provider: "cmpr", url: "https://cmpr.example/", priority: 22 }, events, new Map());
    // Next run without the link: the source's links are replaced, not accumulated.
    await upsertEvents(d1, { id: "cmpr-2026", provider: "cmpr", url: "https://cmpr.example/", priority: 22 }, [{ ...events[0]!, links: [] }], new Map());
    expect(raw.prepare("SELECT count(*) AS n FROM event_links").get()).toEqual({ n: 0 });
  });
});

describe("organizer page of one race (scope 'event')", () => {
  async function setup(opts: { withRace: boolean }) {
    const { d1, raw } = createTestDb();
    raw.exec("UPDATE sources SET enabled = CASE WHEN id = 'kbssped-2026' THEN 1 ELSE 0 END");
    if (opts.withRace) {
      // The race as the organizer's Facebook event reports it.
      const { events } = processExtraction(
        [
          {
            name: "XI. Podbrdské setkání legend 2026", date_from: "2026-10-02", date_to: "2026-10-03", discipline: "rally",
            level: "volny", location_name: "Sedliště", country: "CZ", status: "planned", raw_excerpt: "XI. Podbrdské setkání legend 2026",
            website_url: "https://www.facebook.com/events/1049712654653439/",
          },
          {
            name: "XX. Partr Rally Vsetín", date_from: "2026-10-02", date_to: "2026-10-03", discipline: "rally",
            level: "pohar", location_name: "Vsetín", country: "CZ", status: "planned", raw_excerpt: "Partr Rally Vsetín",
          },
        ],
        2026,
      );
      await upsertEvents(d1, { id: "facebook-2026", provider: "facebook", url: "https://www.facebook.com/", priority: 90 }, events, new Map());
    }
    const http = new PoliteClient({
      userAgent: "test",
      minIntervalMs: 0,
      fetcher: async (url) =>
        url.endsWith("/robots.txt")
          ? new Response("", { status: 404 })
          : url === URL
            ? new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } })
            : new Response("", { status: 404 }),
    });
    const prompts: string[] = [];
    const claude = {
      messages: {
        stream: (req: { messages: { content: { text?: string }[] }[] }) => {
          prompts.push(req.messages[0]!.content.map((c) => c.text ?? "").join("\n"));
          return {
            finalMessage: async () => ({
              stop_reason: "end_turn",
              parsed_output: { events: EXTRACTION.events },
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
          };
        },
      },
    } as unknown as MessagesClient;
    return { d1, raw, prompts, deps: { db: d1, http, geoHttp: http, llm: claudeModel(claude, "m") } };
  }

  it("attaches the page to the race it names: source, website and documents", async () => {
    const t = await setup({ withRace: true });
    const [report] = await runAll(t.deps);
    expect(report).toMatchObject({
      source: "kbssped-2026",
      status: "ok",
      valid: 0,
      invalid: [],
      attached: ["XI. Podbrdské setkání legend 2026 (7 odkazů)"],
      stats: { inserted: 0, updated: 0 },
    });
    expect(t.prompts[0]).toContain(EVENT_PAGE_NOTE);
    expect(t.prompts[0]).toContain("ČASOVÝ HARMONOGRAM (https://www.kbssped.cz/wp-content/uploads/2026/09/Harmonogram_2026.png)");

    expect(t.raw.prepare("SELECT count(*) AS n FROM events").get()).toEqual({ n: 2 });
    const id = (t.raw.prepare("SELECT id FROM events WHERE name LIKE 'XI.%'").get() as { id: string }).id;
    const detail = (await getEvent(t.d1, id))!;
    // The organizer's page (priority 20) replaces the Facebook event link (90).
    expect(detail.website_url).toBe(URL);
    expect(detail.sources.map((s) => s.name)).toEqual(["KBS Sedliště – Podbrdské setkání legend", "Facebook – události pořadatelů"]);
    expect(detail.links?.map((l) => [l.kind, l.label])).toEqual([
      ["harmonogram", "Časový harmonogram"],
      ["mapa", "Mapa"],
      ["divaci", "Informace pro diváky"],
      ["divaci", "Divácká místa"],
      ["propozice", "Zvláštní ustanovení"],
      ["propozice", "Technické požadavky"],
      ["plakat", "Plakát"],
    ]);
    // Vsetín on the same weekend stays untouched.
    expect(t.raw.prepare("SELECT count(*) AS n FROM event_links l JOIN events e ON e.id = l.event_id WHERE e.name LIKE '%Vsetín'").get()).toEqual({ n: 0 });

    // Next run (forced): same links, not doubled.
    await runAll(t.deps, { force: true });
    expect(t.raw.prepare("SELECT count(*) AS n FROM event_links").get()).toEqual({ n: 7 });
  });

  it("creates nothing from a page without a date when no calendar knows the race", async () => {
    const t = await setup({ withRace: false });
    const [report] = await runAll(t.deps);
    expect(report).toMatchObject({ status: "ok", valid: 0, invalid: [{ error: "no race of 2026 named like 'Podbrdské setkání Legend'" }] });
    expect(report).not.toHaveProperty("attached");
    expect(t.raw.prepare("SELECT count(*) AS n FROM events").get()).toEqual({ n: 0 });
  });
});
