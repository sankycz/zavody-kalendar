import { describe, expect, it } from "vitest";
import { ModelError, type JsonModel } from "../src/pipeline/llm.ts";
import { isQuotaError, runAll, type RunDeps } from "../src/pipeline/run.ts";
import { createTestDb } from "./d1shim.ts";

// A weekly run that doesn't fit in the Cron Trigger's 15 minutes must not
// starve the same sources every week (on 12. 10. 2026 everything from priority 40 on).
describe("runAll order and deadline", () => {
  const setup = () => {
    const { d1, raw } = createTestDb();
    raw.exec("UPDATE sources SET enabled = 0");
    raw.exec("UPDATE sources SET enabled = 1 WHERE id IN ('autoklub-cal-pdf-2026', 'edda-2026', 'hillclimbers-2026', 'autosport-2026', 'racingserie-2026', 'kbssped-2026')");
    raw.exec("UPDATE sources SET last_fetched_at = '2026-10-12T03:05:00.000Z' WHERE id IN ('autoklub-cal-pdf-2026', 'edda-2026', 'kbssped-2026')");
    raw.exec("UPDATE sources SET last_fetched_at = '2026-10-12T03:01:00.000Z' WHERE id = 'edda-2026'");
    raw.exec("UPDATE sources SET last_fetched_at = '2026-09-30T14:00:00.000Z' WHERE id = 'autosport-2026'");
    return { deps: { db: d1 } as unknown as RunDeps };
  };

  it("runs the source fetched longest ago first, organizer pages of one race last", async () => {
    const { deps } = setup();
    // Time is up before the first source: nothing is fetched, the order shows in the report.
    const reports = await runAll(deps, { deadline: 0 });
    expect(reports.map((r) => [r.source, r.status])).toEqual([
      ["racingserie-2026", "deferred"], // never fetched, priority 28
      ["hillclimbers-2026", "deferred"], // never fetched, priority 72
      ["autosport-2026", "deferred"], // 30. 9.
      ["edda-2026", "deferred"], // 12. 10. 03:01
      ["autoklub-cal-pdf-2026", "deferred"],
      ["kbssped-2026", "deferred"],
    ]);
  });

  it("leaves out sources fetched within the last week (the daily run)", async () => {
    const { deps } = setup();
    const reports = await runAll(deps, { deadline: 0, fetchedBefore: "2026-10-12T03:03:00.000Z" });
    expect(reports.map((r) => r.source)).toEqual(["racingserie-2026", "hillclimbers-2026", "autosport-2026", "edda-2026"]);
  });

  it("stops when the model's daily allowance is used up; the source is first again tomorrow", async () => {
    const { deps } = setup();
    let calls = 0;
    const quota: JsonModel = {
      json: async () => {
        calls++;
        throw new ModelError("Workers AI: 4006: you have used up your daily free allocation of 10,000 neurons");
      },
    };
    const page = `<html><body><main><p>17.10. Racing Serie Milovice</p><p>${"x".repeat(300)}</p></main></body></html>`;
    const http = { get: async () => new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } }) };
    const reports = await runAll({ ...deps, http, geoHttp: http, llm: quota } as unknown as RunDeps, { fetchedBefore: "2026-10-12T03:03:00.000Z" });
    expect(reports.map((r) => r.status)).toEqual(["error", "deferred", "deferred", "deferred"]);
    expect(calls).toBe(1);
    const again = await runAll(deps, { deadline: 0, fetchedBefore: "2026-10-12T03:03:00.000Z" });
    expect(again[0]!.source).toBe("racingserie-2026");
  });

  it("recognises the Workers AI quota error", () => {
    expect(isQuotaError("all 2 blocks failed: Workers AI: 4006: you have used up your daily free allocation of 10,000 neurons")).toBe(true);
    expect(isQuotaError("HTTP 404 for https://x.cz/")).toBe(false);
  });
});
