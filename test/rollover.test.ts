import { describe, expect, it } from "vitest";
import { PoliteClient } from "../src/pipeline/http.ts";
import { pickLink, rollover, similarity } from "../src/pipeline/rollover.ts";
import { createTestDb } from "./d1shim.ts";

const page = (body: string) => new Response(`<html><body>${body}</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
const links = (...hrefs: string[]) => page(hrefs.map((h) => `<a href="${h}">odkaz</a>`).join(""));

/** The web as it could look in December 2026, after the 2027 calendars came out. */
const WEB: Record<string, () => Response> = {
  "https://www.autoklub.cz/motorsport/automobily/aktuality/": () =>
    links(
      "/211684-grand-prix-ceske-republiky-2027-se-vraci-do-cervence/",
      "/215001-kalendar-automobiloveho-sportu-acr-2027/",
      "/205368-kalendar-automobiloveho-sportu-acr-2026/",
    ),
  "https://www.autoklub.cz/215001-kalendar-automobiloveho-sportu-acr-2027/": () =>
    links(
      "https://www.autoklub.cz/wp-content/uploads/2026/12/rocenka-automobilovy-sport-2027.pdf",
      "https://www.autoklub.cz/wp-content/uploads/2026/12/cal-predbezny-27-v1.pdf",
    ),
  // Soft 404: status 200, but nothing about 2027.
  "https://www.autokaleidoskop.cz/Kalendar/AKTUALIZACE:-Kalendar-automobilovych-zavodu-v-CR-2027/": () => page("Stránka nenalezena"),
  "https://www.autokaleidoskop.cz/Kalendar/": () =>
    links(
      "/Kalendar/AKTUALIZACE:-Veteransky-kalendar-2027-v-Ceske-republice-a-na-Slovensku/",
      "/Kalendar/Kalendar-automobilovych-zavodu-v-CR-2027/",
      "/Kalendar/AKTUALIZACE:-Kalendar-automobilovych-zavodu-v-CR-2026/",
    ),
  // The dates are in the URL: the same address with 2027 is next season's listing.
  "https://www.autoklub.cz/ostatni/kalendar-podniku/?id_sport=1212&termin_od=01.01.2027&termin_do=31.12.2027": () =>
    page('<input name="termin_od" value="01.01.2027"> Celkem nalezeno 3 podniků.'),
  "https://hillclimbers.eu/kalendar?year=2027&country=CZ": () => page("Sezóna 2027 · 10.–11. 4. IX. Prolog Hillclimb AMD Brno 2027"),
  "https://www.krusnohorskypohar.cz/": () =>
    links("/index.php/vysledky-2027/", "/index.php/kalendar-2027/", "/index.php/kalendar-2026/", "/index.php/kalendar-2025/"),
};

function setup(web: Record<string, () => Response> = WEB) {
  const { d1, raw } = createTestDb();
  const asked: string[] = [];
  const http = new PoliteClient({
    userAgent: "test",
    minIntervalMs: 0,
    fetcher: async (url) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      asked.push(url);
      return web[url]?.() ?? new Response("not found", { status: 404 });
    },
  });
  return { d1, raw, http, asked };
}

describe("rollover", () => {
  it("adds next season's row for every source, by the simplest rule that works", async () => {
    const t = setup();
    const results = await rollover(t.d1, t.http, "2026-12-07");
    const added = Object.fromEntries(results.map((r) => [r.source, r.status === "added" ? [r.how, r.url] : [r.status]]));
    expect(added).toEqual({
      "autoklub-cal-html-2026": ["index", "https://www.autoklub.cz/215001-kalendar-automobiloveho-sportu-acr-2027/"],
      "autoklub-cal-pdf-2026": ["index", "https://www.autoklub.cz/wp-content/uploads/2026/12/cal-predbezny-27-v1.pdf"],
      "autokaleidoskop-2026": ["index", "https://www.autokaleidoskop.cz/Kalendar/Kalendar-automobilovych-zavodu-v-CR-2027/"],
      "krusnohorsky-pohar-2026": ["index", "https://www.krusnohorskypohar.cz/index.php/kalendar-2027/"],
      "autoklub-podniky-2026": [
        "year-in-url",
        "https://www.autoklub.cz/ostatni/kalendar-podniku/?id_sport=1212&termin_od=01.01.2027&termin_do=31.12.2027",
      ],
      "edda-2026": ["same-url", "http://www.edda.cz/mscrdovrchu/index.php?m=trate"],
      "cmpr-2026": ["same-url", "https://cmpr.cz/souteze-poharu/"],
      "triola-2026": ["same-url", "http://www.triola-cup.cz/kalendar/"],
      "autodrom-most-2026": ["same-url", "https://www.autodrom-most.cz/kalendar-zavodu-c1423/"],
      "automotodrom-brno-2026": ["same-url", "https://www.automotodrombrno.cz/kalendar-akci/"],
      "facebook-2026": [
        "same-url",
        "autoslalom\nzávod do vrchu\nrallysprint\nautokros\nhttps://www.facebook.com/podbrdskesetkanilegend.cz/events",
      ],
      "kbssped-2026": ["same-url", "https://www.kbssped.cz/?page_id=34"],
      "hillclimbers-2026": ["year-in-url", "https://hillclimbers.eu/kalendar?year=2027&country=CZ"],
      "autosport-2026": ["same-url", "http://www.autosport.cz/souteze/vsechny.php"],
    });
    expect(
      t.raw.prepare("SELECT id, name, kind, via, priority, enabled FROM sources WHERE season = 2027 AND provider IN ('autoklub-cal', 'cmpr', 'facebook') ORDER BY id").all(),
    ).toEqual([
      { id: "autoklub-cal-html-2027", name: "Autoklub ČR – kalendář 2027", kind: "html", via: "web", priority: 11, enabled: 1 },
      { id: "autoklub-cal-pdf-2027", name: "Autoklub ČR – kalendář (PDF) 2027", kind: "pdf", via: "web", priority: 10, enabled: 1 },
      { id: "cmpr-2027", name: "Českomoravský pohár rallye – kalendář 2027", kind: "html", via: "web", priority: 22, enabled: 1 },
      { id: "facebook-2027", name: "Facebook – události pořadatelů 2027", kind: "html", via: "facebook", priority: 90, enabled: 0 },
    ]);

    expect(t.raw.prepare("SELECT max_pages, priority FROM sources WHERE id = 'autoklub-podniky-2027'").get()).toEqual({ max_pages: 10, priority: 9 });
    expect(t.raw.prepare("SELECT scope, priority FROM sources WHERE id = 'kbssped-2027'").get()).toEqual({ scope: "event", priority: 20 });

    // Next run: everything has its 2027 row, nothing is fetched or added again.
    t.asked.length = 0;
    expect(await rollover(t.d1, t.http, "2026-12-14")).toEqual([]);
    expect(t.asked).toEqual([]);
  });

  it("keeps trying while next year's calendar isn't out, and switches past seasons off", async () => {
    const t = setup({});
    const results = await rollover(t.d1, t.http, "2026-10-05");
    expect(results.find((r) => r.source === "autoklub-cal-html-2026")).toEqual({
      source: "autoklub-cal-html-2026",
      season: 2027,
      status: "not-found",
      reason: "index https://www.autoklub.cz/motorsport/automobily/aktuality/ unavailable",
    });
    expect(results.find((r) => r.source === "autoklub-cal-pdf-2026")).toMatchObject({ status: "not-found" });
    expect(t.raw.prepare("SELECT COUNT(*) AS n FROM sources WHERE provider = 'autoklub-cal' AND season = 2027").get()).toEqual({ n: 0 });

    // In 2027 the 2026 rows are done.
    await rollover(t.d1, t.http, "2027-01-04");
    expect(t.raw.prepare("SELECT COUNT(*) AS n FROM sources WHERE season = 2026 AND enabled = 1").get()).toEqual({ n: 0 });
  });
});

describe("pickLink", () => {
  const cur = "https://www.autokaleidoskop.cz/Kalendar/AKTUALIZACE:-Kalendar-automobilovych-zavodu-v-CR-2026/";

  it("prefers the link most like the current one, of the same kind and naming next year", () => {
    const links = [
      "https://www.autokaleidoskop.cz/Kalendar/AKTUALIZACE:-Veteransky-kalendar-2027-v-Ceske-republice/",
      "https://www.autokaleidoskop.cz/Kalendar/AKTUALIZACE:-Kalendar-automobilovych-zavodu-v-CR-2027/",
      "https://www.autokaleidoskop.cz/files/kalendar-automobilovych-zavodu-v-CR-2027.pdf",
    ];
    expect(pickLink(links, cur, "html", 2027, true)).toBe(links[1]);
    expect(pickLink(links.slice(0, 1), cur, "html", 2027, true)).toBeNull();
    expect(pickLink([cur], cur, "html", 2027, true)).toBeNull();
  });

  it("ignores numbers and diacritics when comparing URLs", () => {
    expect(similarity("https://x.cz/205368-kalendář-acr-2026/", "https://x.cz/215001-kalendar-ACR-2027/")).toBe(1);
  });
});
