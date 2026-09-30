import { describe, expect, it } from "vitest";
import type { MessagesClient } from "../src/pipeline/extract.ts";
import { PoliteClient } from "../src/pipeline/http.ts";
import { markFinished, runAll } from "../src/pipeline/run.ts";
import { createTestDb } from "./d1shim.ts";

const event = {
  name: "Rallysprint Kopná", date_from: "2026-05-16", date_to: null, discipline: "rallysprint", series: "RSS",
  level: "pohar", location_name: "Kopná", region: null, country: "CZ", organizer: null, website_url: null,
  description: null, status: "planned", raw_excerpt: "16.5. Rallysprint Kopná",
};

function setup(pages: string[]) {
  const { d1, raw } = createTestDb();
  // Only the Autokaleidoskop HTML source enabled; no geocoding needed (lookups hit the cache below).
  raw.exec("UPDATE sources SET enabled = 0 WHERE id <> 'autokaleidoskop-2026'");
  raw.exec("INSERT INTO locations (query, lat, lng, region, found) VALUES ('Kopná, CZ', 50.1, 13.1, 'Karlovarský kraj', 1)");

  let run = 0;
  const http = new PoliteClient({
    userAgent: "test/0.1",
    minIntervalMs: 0,
    sleep: async () => {},
    fetcher: async (url) =>
      url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : new Response(pages[Math.min(run, pages.length - 1)]),
  });
  let modelCalls = 0;
  const claude = {
    messages: {
      stream: () => {
        modelCalls++;
        return {
          finalMessage: async () => ({
            stop_reason: "end_turn",
            parsed_output: { events: [event] },
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        };
      },
    },
  } as unknown as MessagesClient;
  const deps = { db: d1, http, geoHttp: http, claude, model: "m" };
  return {
    raw,
    d1,
    runDay: async () => {
      const r = await runAll(deps);
      run++;
      return r;
    },
    modelCalls: () => modelCalls,
  };
}

describe("daily run", () => {
  it("does not call the model again when only scripts / ads changed", async () => {
    const page = (noise: string) =>
      `<html><head><script>var nonce="${noise}"</script></head><body><main><p>16.5. Rallysprint Kopná (RSS)</p><p>${"x".repeat(250)}</p></main><footer>${noise}</footer></body></html>`;
    const t = setup([page("a"), page("b"), page("b").replace("16.5.", "17.5.")]);

    expect((await t.runDay())[0]).toMatchObject({ status: "ok", valid: 1 });
    expect((await t.runDay())[0]).toMatchObject({ status: "unchanged" });
    expect(t.modelCalls()).toBe(1);
    expect((await t.runDay())[0]).toMatchObject({ status: "ok" });
    expect(t.modelCalls()).toBe(2);
  });

  it("marks past events finished, keeps cancelled and upcoming ones", async () => {
    const { d1, raw } = createTestDb();
    raw.exec(`INSERT INTO events (name, date_from, date_to, discipline, level, status, dedupe_key) VALUES
      ('past', '2026-05-01', NULL, 'rally', 'mcr', 'planned', 'a'),
      ('running', '2026-05-09', '2026-05-10', 'rally', 'mcr', 'planned', 'b'),
      ('cancelled', '2026-05-02', NULL, 'rally', 'mcr', 'cancelled', 'c'),
      ('upcoming', '2026-06-01', NULL, 'rally', 'mcr', 'planned', 'd')`);
    expect(await markFinished(d1, "2026-05-10")).toBe(1);
    expect(raw.prepare("SELECT name, status FROM events ORDER BY dedupe_key").all()).toEqual([
      { name: "past", status: "finished" },
      { name: "running", status: "planned" },
      { name: "cancelled", status: "cancelled" },
      { name: "upcoming", status: "planned" },
    ]);
  });
});

describe("updated_at", () => {
  it("changes only when event data changes", async () => {
    const { raw } = createTestDb();
    raw.exec(`INSERT INTO events (name, date_from, discipline, level, dedupe_key, updated_at)
              VALUES ('A', '2026-05-01', 'rally', 'mcr', 'k', '2026-01-01T00:00:00.000Z')`);
    raw.exec("UPDATE events SET name = 'A', status = 'planned'");
    expect(raw.prepare("SELECT updated_at FROM events").get()).toEqual({ updated_at: "2026-01-01T00:00:00.000Z" });
    raw.exec("UPDATE events SET name = 'B'");
    expect((raw.prepare("SELECT updated_at FROM events").get() as { updated_at: string }).updated_at).not.toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });
});
