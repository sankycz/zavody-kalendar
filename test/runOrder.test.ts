import { describe, expect, it } from "vitest";
import { runAll, type RunDeps } from "../src/pipeline/run.ts";
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
});
