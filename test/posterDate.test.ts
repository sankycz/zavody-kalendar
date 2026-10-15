import { describe, expect, it } from "vitest";
import { posterDate } from "../web/src/format.ts";

describe("posterDate (share image)", () => {
  it("one day", () => expect(posterDate("2026-10-18", null)).toBe("18. ŘÍJNA"));
  it("same day as both ends", () => expect(posterDate("2026-10-18", "2026-10-18")).toBe("18. ŘÍJNA"));
  it("days in one month", () => expect(posterDate("2026-10-16", "2026-10-17")).toBe("16.–17. ŘÍJNA"));
  it("across months", () => expect(posterDate("2026-09-30", "2026-10-01")).toBe("30. 9. – 1. 10."));
});
