import { describe, expect, it } from "vitest";
import { getEvent, listEvents, todayInPrague } from "../src/api.ts";
import type { MessagesClient } from "../src/pipeline/extract.ts";
import { claudeModel } from "../src/pipeline/llm.ts";
import { PoliteClient } from "../src/pipeline/http.ts";
import { checkOrganizers, interpret, type OrganizerCheck } from "../src/pipeline/organizer.ts";
import { processExtraction } from "../src/pipeline/run.ts";
import { upsertEvents } from "../src/pipeline/upsert.ts";
import { createTestDb } from "./d1shim.ts";

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const TODAY = todayInPrague();
const SOON = addDays(TODAY, 5);
const AUTOKLUB = { id: "autoklub-cal-pdf-2026", provider: "autoklub-cal", url: "https://x.example/", priority: 10 };

const item = (name: string, date_from: string, loc: string, website_url: string | null) => ({
  name, date_from, date_to: null, discipline: "rally", level: "mcr", location_name: loc, series: null, region: null,
  country: "CZ", organizer: null, website_url, description: null, status: "planned", raw_excerpt: name,
});

const ok = (c: Partial<OrganizerCheck>): OrganizerCheck => ({
  mentions_event: true, status: "planned", date_from: null, date_to: null, notice: null, ...c,
});

describe("interpret", () => {
  const e = { date_from: "2026-05-16", date_to: "2026-05-17" };
  it("not mentioned -> no findings", () => {
    expect(interpret(e, ok({ mentions_event: false, status: "cancelled" }))).toMatchObject({ outcome: "not_mentioned", status: null });
  });
  it("same dates -> confirmed, notice dropped", () => {
    expect(interpret(e, ok({ date_from: "16.5.2026", date_to: "2026-05-17", notice: "vše platí" }))).toEqual({
      outcome: "confirmed", status: "planned", date_from: null, date_to: null, notice: null,
    });
  });
  it("cancelled keeps the notice", () => {
    expect(interpret(e, ok({ status: "cancelled", notice: "Závod se ruší kvůli  opravě silnice." }))).toMatchObject({
      outcome: "changed", status: "cancelled", notice: "Závod se ruší kvůli opravě silnice.",
    });
  });
  it("different dates are reported, nonsense dates ignored", () => {
    expect(interpret(e, ok({ date_from: "2026-06-13", date_to: "2026-06-14" }))).toMatchObject({
      outcome: "changed", date_from: "2026-06-13", date_to: "2026-06-14",
    });
    expect(interpret(e, ok({ date_from: "31.4.2026" }))).toMatchObject({ outcome: "confirmed", date_from: null });
  });
});

function setup() {
  const { d1, raw } = createTestDb();
  const pages = new Map<string, string | number>();
  const fetched: string[] = [];
  const http = new PoliteClient({
    userAgent: "test/0.1",
    minIntervalMs: 0,
    sleep: async () => {},
    fetcher: async (url) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      fetched.push(url);
      const p = pages.get(url);
      return typeof p === "number" ? new Response("", { status: p }) : new Response(p ?? "", { headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  });
  let answer: OrganizerCheck = ok({});
  const prompts: string[] = [];
  const claude = {
    messages: {
      stream: (params: { messages: { content: { text: string }[] }[] }) => {
        prompts.push(params.messages[0]!.content.map((c) => c.text).join("\n"));
        return { finalMessage: async () => ({ stop_reason: "end_turn", parsed_output: answer, usage: {} }) };
      },
    },
  } as unknown as MessagesClient;
  return {
    d1, raw, pages, fetched, prompts,
    answer: (a: OrganizerCheck) => { answer = a; },
    run: (today = TODAY) => checkOrganizers({ db: d1, http, llm: claudeModel(claude, "m") }, today),
    seed: async (items: ReturnType<typeof item>[]) =>
      upsertEvents(d1, AUTOKLUB, processExtraction(items, Number(TODAY.slice(0, 4))).events, new Map()),
  };
}

describe("checkOrganizers", () => {
  it("checks only upcoming events with a website within two weeks", async () => {
    const t = setup();
    await t.seed([
      item("Soon", SOON, "Klatovy", "https://soon.example/"),
      item("No web", SOON, "Kopná", null),
      item("Far", addDays(TODAY, 30), "Brno", "https://far.example/"),
      item("Past", addDays(TODAY, -3), "Most", "https://past.example/"),
    ]);
    t.pages.set("https://soon.example/", "<main>Rallye Klatovy – termín platí</main>");
    expect(await t.run()).toEqual([{ event_id: expect.any(String), result: "checked", outcome: "confirmed" }]);
    expect(t.fetched).toEqual(["https://soon.example/"]);
    expect(t.prompts[0]).toContain("Závod z kalendáře: Soon");
  });

  it("does not re-check the same day, skips the model when the page is unchanged", async () => {
    const t = setup();
    await t.seed([item("Soon", SOON, "Klatovy", "https://soon.example/")]);
    t.pages.set("https://soon.example/", "<main>Rallye Klatovy</main><script>var n=1</script>");
    await t.run();
    expect(await t.run()).toEqual([]);
    t.pages.set("https://soon.example/", "<main>Rallye Klatovy</main><script>var n=2</script>");
    expect(await t.run(addDays(TODAY, 1))).toEqual([{ event_id: expect.any(String), result: "unchanged" }]);
    expect(t.prompts).toHaveLength(1);
  });

  it("organizer cancellation shows in the API and survives the next calendar ingest", async () => {
    const t = setup();
    const events = [item("Soon", SOON, "Klatovy", "https://soon.example/")];
    await t.seed(events);
    t.pages.set("https://soon.example/", "<main>ZRUŠENO</main>");
    t.answer(ok({ status: "cancelled", notice: "Pořadatel závod zrušil." }));
    await t.run();

    await t.seed(events); // Autoklub still lists it as planned
    const list = await listEvents(t.d1, {}, TODAY);
    expect(list.events[0]).toMatchObject({ name: "Soon", status: "cancelled", organizer_flag: "cancelled" });
    const detail = await getEvent(t.d1, list.events[0]!.id);
    expect(detail!.organizer_check).toMatchObject({
      url: "https://soon.example/", outcome: "changed", status: "cancelled", notice: "Pořadatel závod zrušil.", error: null,
    });
    // Still checked daily, so a reinstated race is picked up again.
    t.pages.set("https://soon.example/", "<main>Závod se koná</main>");
    t.answer(ok({}));
    await t.run(addDays(TODAY, 1));
    expect((await listEvents(t.d1, {}, TODAY)).events[0]).toMatchObject({ status: "planned", organizer_flag: null });
  });

  it("date change is flagged, not written into the event", async () => {
    const t = setup();
    await t.seed([item("Soon", SOON, "Klatovy", "https://soon.example/")]);
    t.pages.set("https://soon.example/", "<main>nový termín</main>");
    t.answer(ok({ date_from: addDays(SOON, 7), notice: "Přesunuto o týden." }));
    await t.run();
    const e = (await listEvents(t.d1, {}, TODAY)).events[0]!;
    expect(e).toMatchObject({ date_from: SOON, status: "planned", organizer_flag: "date_changed" });
    expect((await getEvent(t.d1, e.id))!.organizer_check).toMatchObject({ date_from: addDays(SOON, 7), notice: "Přesunuto o týden." });
  });

  it("a failed fetch keeps earlier findings and records the error", async () => {
    const t = setup();
    await t.seed([item("Soon", SOON, "Klatovy", "https://soon.example/")]);
    t.pages.set("https://soon.example/", "<main>ZRUŠENO</main>");
    t.answer(ok({ status: "cancelled", notice: "Zrušeno." }));
    await t.run();
    t.pages.set("https://soon.example/", 503);
    expect(await t.run(addDays(TODAY, 1))).toEqual([{ event_id: expect.any(String), result: "error", error: "HTTP 503" }]);
    const row = t.raw.prepare("SELECT status, notice, error FROM organizer_checks").get();
    expect(row).toEqual({ status: "cancelled", notice: "Zrušeno.", error: "HTTP 503" });
  });

  it("skips non-HTML pages without calling the model", async () => {
    const t = setup();
    await t.seed([item("Soon", SOON, "Klatovy", "https://soon.example/zvani.pdf")]);
    const { d1 } = t;
    const http = new PoliteClient({
      userAgent: "test/0.1", minIntervalMs: 0, sleep: async () => {},
      fetcher: async (url) =>
        url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : new Response("%PDF", { headers: { "Content-Type": "application/pdf" } }),
    });
    const r = await checkOrganizers({ db: d1, http, llm: claudeModel({} as MessagesClient, "m") }, TODAY);
    expect(r[0]).toMatchObject({ result: "error", error: "unsupported content type application/pdf" });
  });
});
