import { describe, expect, it } from "vitest";
import { normalizeEvent, normalizeLocation, parseDate } from "../src/pipeline/normalize.ts";

const base = {
  name: "Rallye X",
  date_from: "2026-05-22",
  date_to: null,
  discipline: "rally",
  series: null,
  level: "mcr",
  location_name: "Klatovy",
  region: null,
  country: "CZ",
  organizer: null,
  website_url: null,
  description: null,
  status: "planned",
  raw_excerpt: "x",
};

describe("parseDate", () => {
  it.each([
    ["2026-05-09", "2026-05-09"],
    ["9.5.2026", "2026-05-09"],
    ["9. 5. 2026", "2026-05-09"],
    ["09.05.26", "2026-05-09"],
    ["9.5.", "2026-05-09"],
  ])("%s -> %s", (input, expected) => {
    expect(parseDate(input, 2026)).toBe(expected);
  });

  it.each(["31.4.2026", "2026-02-30", "32.1.", "květen", "5/9/2026", "", "2026-5"])("rejects %s", (input) => {
    expect(parseDate(input, 2026)).toBeNull();
  });
});

describe("normalizeLocation", () => {
  it.each([
    ["Klatovy", "Klatovy"],
    ["okolí Přerov", "Přerov"],
    ["Klatovy (centrum)", "Klatovy"],
    ["Šternberk - Ecce Homo", "Šternberk"],
    ["Frýdek-Místek", "Frýdek-Místek"],
    ["  ", null],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeLocation(input)).toBe(expected);
  });
});

describe("normalizeEvent", () => {
  it("accepts a valid item and builds the dedupe key", () => {
    const r = normalizeEvent(base, 2026);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event.dedupe_key).toBe("klatovy|2026-05-22|rally");
  });

  it("maps discipline and level aliases", () => {
    const r = normalizeEvent({ ...base, discipline: "Autoslalom", level: "Přebor" }, 2026);
    expect(r.ok && r.event.discipline).toBe("slalom");
    expect(r.ok && r.event.level).toBe("regionalni");
  });

  it("rejects moto and unknown levels", () => {
    expect(normalizeEvent({ ...base, discipline: "motokros" }, 2026).ok).toBe(false);
    expect(normalizeEvent({ ...base, level: "evropsky" }, 2026).ok).toBe(false);
  });

  it("rejects dates far outside the season", () => {
    expect(normalizeEvent({ ...base, date_from: "2062-05-22" }, 2026).ok).toBe(false);
  });

  it("drops date_to equal to date_from", () => {
    const r = normalizeEvent({ ...base, date_to: "22.5.2026" }, 2026);
    expect(r.ok && r.event.date_to).toBeNull();
  });

  it("keeps only http(s) URLs and adds scheme to www.", () => {
    expect(normalizeEvent({ ...base, website_url: "www.a.example" }, 2026)).toMatchObject({
      ok: true,
      event: { website_url: "https://www.a.example/" },
    });
    expect(normalizeEvent({ ...base, website_url: "javascript:alert(1)" }, 2026)).toMatchObject({
      ok: true,
      event: { website_url: null },
    });
  });

  it("uppercases country and falls back to CZ", () => {
    expect(normalizeEvent({ ...base, country: "at" }, 2026)).toMatchObject({ event: { country: "AT" } });
    expect(normalizeEvent({ ...base, country: "Rakousko" }, 2026)).toMatchObject({ event: { country: "CZ" } });
  });

  it("uses the name for the dedupe key when location is missing", () => {
    const r = normalizeEvent({ ...base, location_name: null }, 2026);
    expect(r.ok && r.event.dedupe_key).toBe("rallye-x|2026-05-22|rally");
  });

  it("never throws on garbage", () => {
    expect(normalizeEvent(null, 2026).ok).toBe(false);
    expect(normalizeEvent({ foo: 1 }, 2026).ok).toBe(false);
  });
});
