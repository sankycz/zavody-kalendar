import { describe, expect, it } from "vitest";
import { handleDoc, MAX_DOC_BYTES } from "../src/docs.ts";
import { PoliteClient } from "../src/pipeline/http.ts";
import { processExtraction } from "../src/pipeline/run.ts";
import { upsertEvents } from "../src/pipeline/upsert.ts";
import type { EventListItem } from "../src/shared/types.ts";
import { OFFLINE_DOC_KINDS, docUrl, offlineDocs, overviewTiles, tilesAround, todayInPrague, weekendRaces, weekendWindow } from "../web/src/offline/plan.ts";
import { DOC_KINDS } from "../src/docs.ts";
import { createTestDb } from "./d1shim.ts";

const race = (id: string, date_from: string, date_to: string | null = null, extra: Partial<EventListItem> = {}): EventListItem => ({
  id, name: id, date_from, date_to, discipline: "rally", series: null, level: "mcr", location_name: "Klatovy", region: null,
  country: "CZ", status: "planned", lat: 49.4, lng: 13.3, source_count: 1, organizer_flag: null, ...extra,
});

describe("coming weekend", () => {
  it("runs from today to Sunday", () => {
    expect(weekendWindow("2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-04" }); // Thursday
    expect(weekendWindow("2026-10-05")).toEqual({ from: "2026-10-05", to: "2026-10-11" }); // Monday
    expect(weekendWindow("2026-10-04")).toEqual({ from: "2026-10-04", to: "2026-10-04" }); // Sunday
  });

  it("picks running and upcoming races until Sunday, not cancelled ones", () => {
    const picked = weekendRaces(
      [
        race("past", "2026-09-26", "2026-09-27"),
        race("running", "2026-09-30", "2026-10-02"),
        race("sat", "2026-10-03"),
        race("cancelled", "2026-10-03", null, { status: "cancelled" }),
        race("organizer-cancelled", "2026-10-03", null, { organizer_flag: "cancelled" }),
        race("next-week", "2026-10-10"),
      ],
      "2026-10-02",
    );
    expect(picked.map((e) => e.id)).toEqual(["running", "sat"]);
  });

  it("keeps at most a handful", () => {
    const many = Array.from({ length: 20 }, (_, i) => race(`r${i}`, "2026-10-03"));
    expect(weekendRaces(many, "2026-10-02")).toHaveLength(8);
  });

  it("a busy weekend keeps the visitor's favourites", () => {
    const many = Array.from({ length: 20 }, (_, i) => race(`r${i}`, i < 10 ? "2026-10-03" : "2026-10-04"));
    const picked = weekendRaces(many, "2026-10-02", 8, ["r19", "r15"]).map((e) => e.id);
    expect(picked).toHaveLength(8);
    expect(picked.slice(0, 2)).toEqual(["r15", "r19"]);
  });

  it("knows today in Czech time", () => {
    expect(todayInPrague(new Date("2026-10-02T22:30:00Z"))).toBe("2026-10-03");
  });
});

describe("map tiles", () => {
  it("a race takes about a hundred tiles, few in detail", () => {
    const T = "https://tiles.openfreemap.org/planet/20260930_001001_pt/{z}/{x}/{y}.pbf";
    const tiles = tilesAround(T, 49.39, 13.29);
    const zoom = (u: string) => Number(/_pt\/(\d+)\//.exec(u)![1]);
    expect(tiles.filter((u) => zoom(u) >= 13).length).toBeLessThan(60);
    expect(tiles.length).toBeLessThan(150);
    expect(new Set(tiles).size).toBe(tiles.length);
    expect(tiles).toContain("https://tiles.openfreemap.org/planet/20260930_001001_pt/11/1099/701.pbf");
  });

  it("covers the whole country at low zooms", () => {
    const tiles = overviewTiles("https://t.example/{z}/{x}/{y}.pbf");
    expect(tiles).toContain("https://t.example/7/69/43.pbf"); // Prague
    expect(tiles.length).toBeLessThan(50);
  });
});

describe("documents for offline use", () => {
  it("takes schedules, maps and posters, once each, not videos", () => {
    const docs = offlineDocs({
      links: [
        { label: "Harmonogram", url: "https://x.cz/h.pdf", kind: "harmonogram" },
        { label: "Harmonogram znovu", url: "https://x.cz/h.pdf", kind: "harmonogram" },
        { label: "Video", url: "https://youtube.com/x", kind: "video" },
        { label: "Plakát", url: "https://x.cz/p.jpg", kind: "plakat" },
      ],
    });
    expect(docs.map((d) => d.label)).toEqual(["Harmonogram", "Plakát"]);
    expect(docUrl("ab", "https://x.cz/h.pdf?a=1")).toBe("/api/events/ab/doc?url=https%3A%2F%2Fx.cz%2Fh.pdf%3Fa%3D1");
  });

  it("uses the same kinds in the app and the Worker", () => {
    expect([...OFFLINE_DOC_KINDS]).toEqual([...DOC_KINDS]);
  });
});

describe("GET /api/events/<id>/doc", () => {
  async function setup(files: Record<string, { type: string; body?: string; status?: number }>) {
    const { d1, raw } = createTestDb();
    const { events } = processExtraction(
      [{ name: "Rally Klatovy", date_from: "2026-10-03", date_to: null, discipline: "rally", level: "mcr", location_name: "Klatovy",
         series: null, region: null, country: "CZ", organizer: null, website_url: null, description: null, status: "planned", raw_excerpt: "x" }],
      2026,
    );
    await upsertEvents(d1, { id: "autoklub-cal-pdf-2026", provider: "autoklub-cal", url: "https://x.example/", priority: 10 }, events, new Map());
    const { id } = raw.prepare("SELECT id FROM events").get() as { id: string };
    const link = raw.prepare("INSERT INTO event_links (event_id, source_id, url, label, kind) VALUES (?, 'autoklub-cal-pdf-2026', ?, ?, ?)");
    link.run(id, "https://org.cz/harmonogram.pdf", "Harmonogram", "harmonogram");
    link.run(id, "https://org.cz/rz", "Divácká místa", "divaci");
    link.run(id, "https://org.cz/plakat.svg", "Plakát", "plakat");
    link.run(id, "https://org.cz/video.mp4", "Video", "video");
    const fetched: string[] = [];
    const http = new PoliteClient({
      userAgent: "zavody-kalendar/test",
      minIntervalMs: 0,
      fetcher: async (url) => {
        fetched.push(url);
        if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private/", { status: 200 });
        const f = files[url];
        return f ? new Response(f.body ?? "data", { status: f.status ?? 200, headers: { "Content-Type": f.type } }) : new Response("", { status: 404 });
      },
    });
    const get = (u: string) => handleDoc(new Request(`https://app.cz${docUrl(id, u)}`), id, { db: d1, get: (x) => http.get(x) });
    return { get, fetched };
  }

  it("serves a linked PDF from our origin", async () => {
    const { get } = await setup({ "https://org.cz/harmonogram.pdf": { type: "application/pdf; charset=binary", body: "%PDF-1.7" } });
    const res = await get("https://org.cz/harmonogram.pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="harmonogram.pdf"');
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.text()).toBe("%PDF-1.7");
  });

  it("is no open proxy: only documents the race links to", async () => {
    const { get, fetched } = await setup({});
    expect((await get("https://evil.example/x.pdf")).status).toBe(404);
    expect((await get("https://org.cz/video.mp4")).status).toBe(404);
    expect(fetched).toEqual([]);
  });

  it("refuses HTML pages and SVG (script on our origin)", async () => {
    const { get } = await setup({
      "https://org.cz/rz": { type: "text/html" },
      "https://org.cz/plakat.svg": { type: "image/svg+xml" },
    });
    expect((await get("https://org.cz/rz")).status).toBe(415);
    expect((await get("https://org.cz/plakat.svg")).status).toBe(415);
  });

  it("refuses documents that are too large", async () => {
    const { get } = await setup({ "https://org.cz/harmonogram.pdf": { type: "application/pdf", body: "x".repeat(MAX_DOC_BYTES + 1) } });
    expect((await get("https://org.cz/harmonogram.pdf")).status).toBe(413);
  });

  it("reports an unreachable document as 502", async () => {
    const { get } = await setup({ "https://org.cz/harmonogram.pdf": { type: "text/html", status: 500 } });
    expect((await get("https://org.cz/harmonogram.pdf")).status).toBe(502);
  });
});
