import { describe, expect, it } from "vitest";
import { handleApi } from "../src/api.ts";
import { eventToIcs, googleCalendarUrl } from "../src/shared/calendar.ts";
import { processExtraction } from "../src/pipeline/run.ts";
import { upsertEvents } from "../src/pipeline/upsert.ts";
import { createTestDb } from "./d1shim.ts";

const race = {
  id: "a".repeat(32), name: "Rallye Šumava Klatovy", date_from: "2026-10-03", date_to: "2026-10-04", location_name: "Klatovy",
  region: "Plzeňský kraj", series: "MČR v rally", organizer: "AMK Klatovy", website_url: "https://rallysumava.cz/", lat: 49.39, lng: 13.29,
  status: "planned" as const,
};
const page = `https://zavody.example/zavod/${race.id}`;

describe("Google Calendar link", () => {
  it("prefills an all-day event over the race days", () => {
    const u = new URL(googleCalendarUrl(race, page));
    expect(u.origin + u.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(u.searchParams.get("action")).toBe("TEMPLATE");
    expect(u.searchParams.get("text")).toBe("Rallye Šumava Klatovy");
    expect(u.searchParams.get("dates")).toBe("20261003/20261005");
    expect(u.searchParams.get("location")).toBe("Klatovy, Plzeňský kraj");
    expect(u.searchParams.get("details")).toContain(page);
  });

  it("one-day race ends the next day; cancelled ones say so", () => {
    const u = new URL(googleCalendarUrl({ ...race, date_to: null, status: "cancelled", location_name: null, region: null }, page));
    expect(u.searchParams.get("dates")).toBe("20261003/20261004");
    expect(u.searchParams.get("text")).toBe("ZRUŠENO: Rallye Šumava Klatovy");
    expect(u.searchParams.has("location")).toBe(false);
  });
});

describe("iCalendar", () => {
  it("folds long lines without splitting characters", () => {
    const ics = eventToIcs({ ...race, name: "Žluťoučký kůň ".repeat(10).trim() }, page, new Date("2026-10-02T08:00:00Z"));
    const lines = ics.split("\r\n");
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(ics.replace(/\r\n /g, "")).toContain(`SUMMARY:${"Žluťoučký kůň ".repeat(10).trim()}`);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261003\r\nDTEND;VALUE=DATE:20261005");
    expect(ics).toContain("DTSTAMP:20261002T080000Z");
  });

  it("GET /api/events/<id>/ics serves it as a calendar", async () => {
    const { d1, raw } = createTestDb();
    const { events } = processExtraction(
      [{ name: "Rallye Šumava", date_from: "2026-10-03", date_to: null, discipline: "rally", level: "mcr", location_name: "Klatovy",
         series: null, region: null, country: "CZ", organizer: null, website_url: null, description: null, status: "planned", raw_excerpt: "x" }],
      2026,
    );
    await upsertEvents(d1, { id: "autoklub-cal-pdf-2026", provider: "autoklub-cal", url: "https://x.example/", priority: 10 }, events, new Map());
    const { id } = raw.prepare("SELECT id FROM events").get() as { id: string };
    const res = await handleApi(new Request(`https://zavody.example/api/events/${id}/ics`), d1);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("SUMMARY:Rallye Šumava");
    expect(body).toContain(`URL:https://zavody.example/zavod/${id}`);
    expect((await handleApi(new Request(`https://zavody.example/api/events/${"f".repeat(32)}/ics`), d1)).status).toBe(404);
  });
});
