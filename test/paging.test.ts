import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MessagesClient } from "../src/pipeline/extract.ts";
import { PoliteClient } from "../src/pipeline/http.ts";
import { claudeModel } from "../src/pipeline/llm.ts";
import { nextPageUrl } from "../src/pipeline/paging.ts";
import { runAll } from "../src/pipeline/run.ts";
import { createTestDb } from "./d1shim.ts";

/** Real first page of Autoklub ČR's events calendar (season 2026, 15 of 94 events). */
const PAGE1 = readFileSync(join(import.meta.dirname, "..", "fixtures", "autoklub-podniky", "autoklub-podniky-2026.html"), "utf8");
const URL1 = "https://www.autoklub.cz/ostatni/kalendar-podniku/?id_sport=1212&termin_od=01.01.2026&termin_do=31.12.2026";
const URL2 = "https://www.autoklub.cz/ostatni/kalendar-podniku/page/2/?id_sport=1212&termin_od=01.01.2026&termin_do=31.12.2026";

/** Shortened page 2 in the same markup, last page (no "›"). */
const PAGE2 = `<div class="calendar"><a href="https://www.autoklub.cz/podnik/xxxi-tipcars-prazsky-rallysprint/" class="calendar__item">
  <div class="calendar__item__date"><strong>27. - 28.</strong><br>listopadu</div>
  <div class="calendar__item__title">XXXI. TipCars Pražský Rallysprint - ZRUŠENO<br><div>Volné podniky rally</div></div></a></div>
  <ul class="pagination"><li><a href="${URL1.replaceAll("&", "&amp;")}">1</a></li><li class="active"><a href="${URL2.replaceAll("&", "&amp;")}">2</a></li></ul>`;

describe("nextPageUrl", () => {
  it("finds the › link of the real pagination (with &amp; in the URL)", () => {
    expect(nextPageUrl(PAGE1, URL1)).toBe(URL2);
  });

  it.each([
    ['<a rel="next" href="/p/2">dál</a>', "https://x.cz/p/2"],
    ['<a class="next page-numbers" href="/p/2"><span>Následující</span></a>', "https://x.cz/p/2"],
    ['<a href="/p/2">Další &raquo;</a>', "https://x.cz/p/2"],
    ['<a href="https://jinde.cz/p/2">›</a>', null],
    ['<a href="/p/2">2</a><a href="#top">›</a>', null],
  ])("%s → %s", (html, want) => {
    expect(nextPageUrl(html, "https://x.cz/p/1")).toBe(want);
  });
});

describe("paginated source", () => {
  function setup(maxPages: number) {
    const { d1, raw } = createTestDb();
    raw.exec("UPDATE sources SET enabled = CASE WHEN id = 'autoklub-podniky-2026' THEN 1 ELSE 0 END");
    raw.exec(`UPDATE sources SET max_pages = ${maxPages} WHERE id = 'autoklub-podniky-2026'`);
    raw.exec("INSERT INTO locations (query, lat, lng, region, country, found) VALUES ('Praha, CZ', 50.08, 14.42, 'Hlavní město Praha', 'CZ', 1)");
    const fetched: string[] = [];
    const http = new PoliteClient({
      userAgent: "test",
      minIntervalMs: 0,
      fetcher: async (url) => {
        if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
        fetched.push(url);
        const body = url === URL1 ? PAGE1 : url === URL2 ? PAGE2 : null;
        return body ? new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } }) : new Response("", { status: 404 });
      },
    });
    const prompts: string[] = [];
    const claude = {
      messages: {
        stream: (req: { messages: { content: { text?: string }[] }[] }) => {
          prompts.push(req.messages[0]!.content.map((c) => c.text ?? "").join("\n"));
          return {
            finalMessage: async () => ({
              stop_reason: "end_turn",
              parsed_output: {
                events: [
                  {
                    name: "XXXI. TipCars Pražský Rallysprint", date_from: "2026-11-27", date_to: "2026-11-28", discipline: "rallysprint",
                    series: null, level: "volny", location_name: "Praha", region: null, country: "CZ", organizer: null,
                    website_url: null, description: null, status: "cancelled", raw_excerpt: "XXXI. TipCars Pražský Rallysprint - ZRUŠENO",
                  },
                ],
              },
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
          };
        },
      },
    } as unknown as MessagesClient;
    return { raw, fetched, prompts, deps: { db: d1, http, geoHttp: http, llm: claudeModel(claude, "m") } };
  }

  it("reads every page into one source text", async () => {
    const t = setup(10);
    const [report] = await runAll(t.deps);
    expect(report).toMatchObject({ source: "autoklub-podniky-2026", status: "ok", stats: { inserted: 1 } });
    expect(t.fetched).toEqual([URL1, URL2]);
    expect(t.prompts[0]).toContain("60. Šmucler Rally Šumava Klatovy"); // page 1
    expect(t.prompts[0]).toContain("TipCars Pražský Rallysprint - ZRUŠENO"); // page 2
    expect(t.raw.prepare("SELECT name, status FROM events").all()).toEqual([{ name: "XXXI. TipCars Pražský Rallysprint", status: "cancelled" }]);
  });

  it("stops at max_pages", async () => {
    const t = setup(1);
    await runAll(t.deps);
    expect(t.fetched).toEqual([URL1]);
  });
});
