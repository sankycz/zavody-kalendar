import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MessagesClient } from "../src/pipeline/extract.ts";
import { apifyEvents, facebookInput, parseTargets, type FbEvent } from "../src/pipeline/facebook.ts";
import { PoliteClient } from "../src/pipeline/http.ts";
import { claudeModel } from "../src/pipeline/llm.ts";
import { runAll } from "../src/pipeline/run.ts";
import { createTestDb } from "./d1shim.ts";

/** Real actor output (apify/facebook-events-scraper, search "závod do vrchu" etc.), organizer fields left out. */
const dataset = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "fixtures", "facebook", "facebook-2026.dataset.json"), "utf8"),
) as FbEvent[];

/** Synthetic Czech car race, the kind the source is for. */
const slalom: FbEvent = {
  url: "https://www.facebook.com/events/111/",
  name: "Autoslalom Vysoké Mýto",
  utcStartDate: "2026-06-13T07:00:00.000Z",
  duration: "8 hr",
  isOnline: false,
  description: "Přihlášky na info@example.cz nebo 777 123 456. Třídy do 1400 ccm a nad 2000 ccm.",
  location: { name: "Letiště Vysoké Mýto", city: "Vysoké Mýto, Czech Republic", countryCode: "CZ", latitude: 49.93, longitude: 16.18 },
};

describe("parseTargets", () => {
  it("splits Facebook URLs from search phrases, one per line", () => {
    expect(parseTargets(" https://www.facebook.com/x/upcoming_hosted_events \n\nautoslalom\nzávod do vrchu ")).toEqual({
      startUrls: ["https://www.facebook.com/x/upcoming_hosted_events"],
      searchQueries: ["autoslalom", "závod do vrchu"],
    });
  });
});

describe("facebookInput", () => {
  it("keeps events in the Czech Republic with a known place, one line each, by date", () => {
    const fb = facebookInput(dataset, 2026);
    const lines = fb.text.split("\n").slice(1);
    expect(fb.skipped).toBe(3); // Norway, Australia, no location
    expect(lines.map((l) => l.slice(0, 10))).toEqual(["2026-09-12", "2026-09-13", "2026-10-17"]);
    expect(lines[0]).toContain("| ZÁVOD DO VRCHU | místo: Klecany, Náměstí Třebízského, Klecany, Czech Republic | https://www.facebook.com/events/1079337924581415/");
    expect(fb.points.get("https://www.facebook.com/events/1617291233447981/")).toEqual({ lat: 49.75, lng: 16.6667, region: null, country: "CZ" });
  });

  it("leaves out past events (the calendars cover them)", () => {
    const fb = facebookInput([slalom, { ...slalom, url: "https://www.facebook.com/events/333/", isPast: true }], 2026);
    expect(fb.skipped).toBe(1);
    expect(fb.points.has("https://www.facebook.com/events/333/")).toBe(false);
  });

  it("drops contact details and other seasons", () => {
    const fb = facebookInput([slalom, { ...slalom, url: "https://www.facebook.com/events/222/", utcStartDate: "2025-06-13T07:00:00.000Z" }], 2026);
    expect(fb.skipped).toBe(1);
    expect(fb.text).toContain("| trvání: 8 hr | popis: Přihlášky na nebo . Třídy do 1400 ccm");
    expect(fb.text).not.toMatch(/example\.cz|777/);
  });
});

describe("apifyEvents", () => {
  it("runs the actor synchronously with the targets and a cost cap", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const client = apifyEvents("tok", 50, async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return Response.json([slalom]);
    });
    expect(await client.events({ startUrls: ["https://www.facebook.com/x"], searchQueries: [] })).toEqual([slalom]);
    const { url, init } = calls[0]!;
    expect(url).toBe("https://api.apify.com/v2/acts/apify~facebook-events-scraper/run-sync-get-dataset-items?timeout=280&maxTotalChargeUsd=1");
    expect(init!.headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(JSON.parse(init!.body as string)).toEqual({ startUrls: ["https://www.facebook.com/x"], searchQueries: [], maxEvents: 50 });
  });

  it("fails on an API error", async () => {
    const client = apifyEvents("bad", 10, async () => new Response("invalid token", { status: 401 }));
    await expect(client.events({ startUrls: [], searchQueries: ["x"] })).rejects.toThrow("Apify 401: invalid token");
  });
});

describe("facebook source run", () => {
  function setup(apify?: { events: () => Promise<FbEvent[]> }) {
    const { d1, raw } = createTestDb();
    raw.exec("UPDATE sources SET enabled = CASE WHEN id = 'facebook-2026' THEN 1 ELSE 0 END");
    const geoHttp = new PoliteClient({
      userAgent: "test",
      minIntervalMs: 0,
      fetcher: async (url) =>
        url.endsWith("/robots.txt")
          ? new Response("", { status: 404 })
          : Response.json({ results: [{ latitude: 49.95, longitude: 16.16, country_code: "CZ", admin1: "Pardubický" }] }),
    });
    const prompts: string[] = [];
    const claude = {
      messages: {
        stream: (req: { messages: { content: { type: string; text?: string }[] }[] }) => {
          prompts.push(req.messages[0]!.content.map((c) => c.text ?? "").join("\n"));
          return {
            finalMessage: async () => ({
              stop_reason: "end_turn",
              parsed_output: {
                events: [
                  {
                    name: "Autoslalom Vysoké Mýto", date_from: "2026-06-13", date_to: null, discipline: "slalom", series: null,
                    level: "volny", location_name: "Vysoké Mýto", region: null, country: "CZ", organizer: null,
                    website_url: "https://www.facebook.com/events/111/", description: null, status: "planned",
                    raw_excerpt: "2026-06-13 | Autoslalom Vysoké Mýto | místo: Letiště Vysoké Mýto | https://www.facebook.com/events/111/ | popis: Třídy do 1400 ccm",
                  },
                ],
              },
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
          };
        },
      },
    } as unknown as MessagesClient;
    const deps = { db: d1, http: geoHttp, geoHttp, llm: claudeModel(claude, "m"), ...(apify ? { apify } : {}) };
    return { raw, deps, prompts };
  }

  it("stores car races with Facebook's coordinates and the geocoder's region, without the description", async () => {
    const t = setup({ events: async () => [...dataset, slalom] });
    const [report] = await runAll(t.deps);
    expect(report).toMatchObject({ source: "facebook-2026", status: "ok", valid: 1, stats: { inserted: 1 } });
    expect(t.prompts[0]).toContain("https://www.facebook.com/events/111/");
    expect(t.raw.prepare("SELECT name, lat, lng, region, country FROM events").all()).toEqual([
      { name: "Autoslalom Vysoké Mýto", lat: 49.93, lng: 16.18, region: "Pardubický kraj", country: "CZ" },
    ]);
    expect(t.raw.prepare("SELECT raw_excerpt FROM event_sources").get()).toEqual({
      raw_excerpt: "2026-06-13 | Autoslalom Vysoké Mýto | místo: Letiště Vysoké Mýto | https://www.facebook.com/events/111/",
    });
  });

  it("reports a missing APIFY_TOKEN as a source error", async () => {
    const t = setup();
    expect(await runAll(t.deps)).toEqual([{ source: "facebook-2026", status: "error", error: "APIFY_TOKEN is not set" }]);
  });
});
