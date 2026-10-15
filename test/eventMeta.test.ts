import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eventDateText, eventMeta, eventPageHtml } from "../src/eventMeta.ts";

const race = {
  name: "Rallye Miriquidi",
  date_from: "2026-10-16",
  date_to: "2026-10-17",
  discipline: "rally",
  location_name: "Cínovec",
  region: "Ústecký kraj",
  country: "CZ",
  status: "planned",
} as const;

describe("race link preview", () => {
  it("formats the date", () => {
    expect(eventDateText("2026-10-18", null)).toBe("18. října 2026");
    expect(eventDateText("2026-10-16", "2026-10-17")).toBe("16.–17. října 2026");
    expect(eventDateText("2026-09-30", "2026-10-01")).toBe("30. září – 1. října 2026");
    expect(eventDateText("2026-12-31", "2027-01-01")).toBe("31. prosince 2026 – 1. ledna 2027");
  });

  it("describes the race", () => {
    expect(eventMeta(race)).toEqual({ title: "Rallye Miriquidi", description: "16.–17. října 2026 · Cínovec, Ústecký kraj · Rally" });
    expect(eventMeta({ ...race, status: "cancelled", country: "DE", region: null }).description).toBe(
      "Zrušeno · 16.–17. října 2026 · Cínovec, Německo · Rally",
    );
  });

  it("puts the race into index.html, escaped", () => {
    const html = readFileSync(join(import.meta.dirname, "../web/index.html"), "utf8");
    const out = eventPageHtml(html, { ...race, name: 'Rally "Mělník" <test>' }, "https://www.zavody-aut.cz/zavod/abc");
    expect(out).toContain("<title>Rally &#34;Mělník&#34; &#60;test&#62; – Závody aut v ČR</title>");
    expect(out).toContain('<meta property="og:title" content="Rally &#34;Mělník&#34; &#60;test&#62;" />');
    expect(out).toContain('<meta property="og:url" content="https://www.zavody-aut.cz/zavod/abc" />');
    expect(out).toContain('<meta property="og:description" content="16.–17. října 2026 · Cínovec, Ústecký kraj · Rally" />');
    expect(out).toContain('<meta name="description" content="16.–17. října 2026 · Cínovec, Ústecký kraj · Rally" />');
    expect(out).toContain('<meta property="og:type" content="article" />');
    expect(out).toContain('<meta property="og:image" content="https://www.zavody-aut.cz/og-image.png" />');
  });
});
