import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getEvent, listEvents, todayInPrague } from "../src/api.ts";
import { PoliteClient } from "../src/pipeline/http.ts";
import { claudeModel, workersAiModel, type AiBinding, type MessagesClient } from "../src/pipeline/llm.ts";
import { processExtraction } from "../src/pipeline/run.ts";
import { checkStages, normalizeStages, parseTime } from "../src/pipeline/stages.ts";
import { upsertEvents } from "../src/pipeline/upsert.ts";
import { createTestDb } from "./d1shim.ts";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "stages");
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
const text = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const modelOutput = (name: string): unknown[] => JSON.parse(text(name)).stages;

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

describe("parseTime", () => {
  it("accepts the ways organizers write times", () => {
    expect(parseTime("08:04")).toBe("08:04");
    expect(parseTime("8.35")).toBe("08:35");
    expect(parseTime("7:30 hod.")).toBe("07:30");
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("8:60")).toBeNull();
    expect(parseTime("ráno")).toBeNull();
    expect(parseTime(null)).toBeNull();
  });
});

describe("normalizeStages over real model output", () => {
  it("timetable image (Podbrdské setkání legend): four stages with the first car, no closures", () => {
    const e = { date_from: "2026-10-02", date_to: "2026-10-03" };
    const { stages, skipped } = normalizeStages(e, modelOutput("podbrdske-legendy-2026-harmonogram.stages.json"));
    expect(skipped).toEqual([]);
    expect(stages.map((s) => [s.name, s.date, s.first_car, s.closed_from])).toEqual([
      ["RZ 1 Vrčeňská 1", "2026-10-03", "08:04", null],
      ["RZ 2 Vrčeňská 2", "2026-10-03", "10:14", null],
      ["RZ 3 Srbská 1", "2026-10-03", "13:14", null],
      ["RZ 4 Srbská 2", "2026-10-03", "15:14", null],
    ]);
    expect(stages[0]!.length_km).toBe(13.58);
  });

  it("spectator info with closures: times checked against the text, sorted by day and time", () => {
    const e = { date_from: "2026-10-17", date_to: "2026-10-18" };
    const doc = text("synteticke-uzavirky.txt");
    const { stages, skipped } = normalizeStages(e, modelOutput("synteticke-uzavirky.stages.json"), doc);
    expect(skipped).toEqual([]);
    expect(stages.map((s) => `${s.date} ${s.name} ${s.closed_from}–${s.closed_to} ${s.first_car}`)).toEqual([
      "2026-10-17 RZ 1 Horní Lhota 07:30–13:00 08:35",
      "2026-10-17 RZ 2 Dolní Ves 08:15–14:30 09:18",
      "2026-10-17 RZ 3 Horní Lhota 07:30–13:00 11:40",
      "2026-10-17 RZ 4 Dolní Ves 08:15–14:30 12:23",
      "2026-10-18 RZ 5 Superzkouška Areál 09:00–11:30 10:05",
    ]);
  });

  it("drops made-up times, dates outside the race and stages without any time", () => {
    const e = { date_from: "2026-10-17", date_to: "2026-10-18" };
    const doc = "RZ 1 Lhota start 8:35, uzavřeno 7.30 – 13.00. RZ 2 Ves start 9:18.";
    const { stages, skipped } = normalizeStages(
      e,
      [
        { name: "RZ 1 Lhota", date: "2026-10-17", first_car: "8:35", closed_from: "07:30", closed_to: "13:00" },
        { name: "RZ 2 Ves", date: "2026-11-17", first_car: "09:18", closed_from: "08:00", closed_to: "14:00" },
        { name: "RZ 3 Bez času", date: "2026-10-18", first_car: "10:10" },
        { name: "", first_car: "8:35" },
        { foo: 1 },
      ],
      doc,
    );
    expect(stages).toEqual([
      { name: "RZ 2 Ves", date: null, first_car: "09:18", closed_from: null, closed_to: null, length_km: null },
      { name: "RZ 1 Lhota", date: "2026-10-17", first_car: "08:35", closed_from: "07:30", closed_to: "13:00", length_km: null },
    ]);
    expect(skipped).toHaveLength(3);
  });

  it("a one-day race gets its date when the document gives none", () => {
    const { stages } = normalizeStages({ date_from: "2026-10-10", date_to: null }, [{ name: "Trať", closed_from: "7:00", closed_to: "18:00" }]);
    expect(stages[0]).toMatchObject({ date: "2026-10-10", closed_from: "07:00", closed_to: "18:00" });
  });
});

const TODAY = todayInPrague();
const SOON = addDays(TODAY, 5);
const AUTOKLUB = { id: "autoklub-cal-pdf-2026", provider: "autoklub-cal", url: "https://x.example/", priority: 10 };

const item = (name: string, date_from: string, discipline: string, website_url: string | null = null) => ({
  name, date_from, date_to: addDays(date_from, 1), discipline, level: "mcr", location_name: name, series: null, region: null,
  country: "CZ", organizer: null, website_url, description: null, status: "planned", raw_excerpt: name,
});

type Page = { body: string | Uint8Array; type: string } | number;

function setup() {
  const { d1, raw } = createTestDb();
  const pages = new Map<string, Page>();
  const fetched: string[] = [];
  const http = new PoliteClient({
    userAgent: "test/0.1",
    minIntervalMs: 0,
    sleep: async () => {},
    fetcher: async (url) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      fetched.push(url);
      const p = pages.get(url) ?? 404;
      return typeof p === "number" ? new Response("", { status: p }) : new Response(p.body, { headers: { "Content-Type": p.type } });
    },
  });
  const answers = new Map<string, unknown[]>();
  const requests: { content: { type: string; text?: string; source?: { media_type: string } }[] }[] = [];
  const claude = {
    messages: {
      stream: (params: { messages: { content: { type: string; text?: string; source?: { media_type: string } }[] }[] }) => {
        const content = params.messages[0]!.content;
        requests.push({ content });
        const url = /Dokument: (\S+)/.exec(content.map((c) => c.text ?? "").join("\n"))?.[1] ?? "";
        return { finalMessage: async () => ({ stop_reason: "end_turn", parsed_output: { stages: answers.get(url) ?? [] }, usage: {} }) };
      },
    },
  } as unknown as MessagesClient;
  const seed = async (items: ReturnType<typeof item>[]) => {
    await upsertEvents(d1, AUTOKLUB, processExtraction(items, Number(TODAY.slice(0, 4))).events, new Map());
    return (await listEvents(d1, {}, TODAY)).events;
  };
  const link = (eventId: string, url: string, kind: string, label = kind) =>
    raw.prepare("INSERT INTO event_links (event_id, source_id, url, label, kind) VALUES (?, ?, ?, ?, ?)").run(eventId, AUTOKLUB.id, url, label, kind);
  return {
    d1, pages, fetched, answers, requests, seed, link,
    run: (today = TODAY) => checkStages({ db: d1, http, llm: claudeModel(claude, "m") }, today),
  };
}

describe("checkStages", () => {
  it("reads the timetable image of an upcoming rally and shows its stages in the race detail", async () => {
    const t = setup();
    const [rally] = await t.seed([item("Sedliště", SOON, "rally")]);
    t.link(rally!.id, "https://kbs.example/plakat.jpg", "plakat");
    t.link(rally!.id, "https://kbs.example/harmonogram.jpg", "harmonogram", "Časový harmonogram");
    t.pages.set("https://kbs.example/harmonogram.jpg", { body: fixture("podbrdske-legendy-2026-harmonogram.jpg"), type: "image/jpeg" });
    t.answers.set("https://kbs.example/harmonogram.jpg", [{ name: "RZ 1 Vrčeňská 1", date: SOON, first_car: "08:04", length_km: 13.58 }]);

    expect(await t.run()).toEqual([{ event_id: rally!.id, result: "checked", stages: 1, doc_url: "https://kbs.example/harmonogram.jpg" }]);
    expect(t.fetched).toEqual(["https://kbs.example/harmonogram.jpg"]); // poster is not read
    expect(t.requests[0]!.content[0]).toMatchObject({ type: "image", source: { media_type: "image/jpeg" } });

    const detail = await getEvent(t.d1, rally!.id);
    expect(detail!.stages).toEqual({
      doc_url: "https://kbs.example/harmonogram.jpg",
      checked_at: expect.any(String),
      items: [{ name: "RZ 1 Vrčeňská 1", date: SOON, first_car: "08:04", closed_from: null, closed_to: null, length_km: 13.58 }],
    });
  });

  it("only rallies and hill climbs within two weeks; not again the same day; no model call for unchanged documents", async () => {
    const t = setup();
    const events = await t.seed([
      item("Klatovy", SOON, "rally", "https://rally.example/"),
      item("Most", SOON, "okruh", "https://okruh.example/"),
      item("Brno", addDays(TODAY, 30), "vrch", "https://far.example/"),
    ]);
    const rally = events.find((e) => e.name === "Klatovy")!;
    t.pages.set("https://rally.example/", { body: "<main>RZ 1 Lhota start 9:05</main>", type: "text/html; charset=utf-8" });
    t.answers.set("https://rally.example/", [{ name: "RZ 1 Lhota", first_car: "9:05" }]);

    expect(await t.run()).toEqual([{ event_id: rally.id, result: "checked", stages: 1, doc_url: "https://rally.example/" }]);
    expect(await t.run()).toEqual([]);
    expect(await t.run(addDays(TODAY, 1))).toEqual([{ event_id: rally.id, result: "unchanged" }]);
    expect(t.requests).toHaveLength(1);
    expect(t.fetched).toEqual(["https://rally.example/", "https://rally.example/"]);
  });

  it("a page without stage times leaves the detail without stages; a made-up time is dropped", async () => {
    const t = setup();
    const [rally] = await t.seed([item("Klatovy", SOON, "rally", "https://rally.example/")]);
    t.pages.set("https://rally.example/", { body: "<main>Těšíme se na vás</main>", type: "text/html" });
    t.answers.set("https://rally.example/", [{ name: "RZ 1", first_car: "8:00" }]);
    expect(await t.run()).toEqual([{ event_id: rally!.id, result: "checked", stages: 0, doc_url: null }]);
    expect((await getEvent(t.d1, rally!.id))!.stages).toBeNull();
  });

  it("without documents nothing is asked; a failed document keeps earlier stages", async () => {
    const t = setup();
    const [rally] = await t.seed([item("Klatovy", SOON, "rally")]);
    expect(await t.run()).toEqual([{ event_id: rally!.id, result: "no_documents" }]);

    t.link(rally!.id, "https://rally.example/divaci.html", "divaci");
    t.pages.set("https://rally.example/divaci.html", { body: "<p>RZ 2 Ves uzavřeno 7:00–12:00</p>", type: "text/html" });
    t.answers.set("https://rally.example/divaci.html", [{ name: "RZ 2 Ves", closed_from: "07:00", closed_to: "12:00" }]);
    await t.run(addDays(TODAY, 1));
    t.pages.set("https://rally.example/divaci.html", 500);
    expect(await t.run(addDays(TODAY, 2))).toEqual([{ event_id: rally!.id, result: "no_documents" }]);
    expect((await getEvent(t.d1, rally!.id))!.stages?.items).toEqual([
      { name: "RZ 2 Ves", date: null, first_car: null, closed_from: "07:00", closed_to: "12:00", length_km: null },
    ]);
  });

  it("prefers the document with closure times over a timetable", async () => {
    const t = setup();
    const [rally] = await t.seed([item("Klatovy", SOON, "rally")]);
    t.link(rally!.id, "https://r.example/harmonogram.html", "harmonogram");
    t.link(rally!.id, "https://r.example/divaci.html", "divaci");
    t.pages.set("https://r.example/harmonogram.html", { body: "RZ 1 8:05, RZ 2 10:05", type: "text/html" });
    t.pages.set("https://r.example/divaci.html", { body: "RZ 1/2 uzavřeno 7:00–12:00", type: "text/html" });
    t.answers.set("https://r.example/harmonogram.html", [{ name: "RZ 1", first_car: "8:05" }, { name: "RZ 2", first_car: "10:05" }]);
    t.answers.set("https://r.example/divaci.html", [{ name: "RZ 1/2", closed_from: "7:00", closed_to: "12:00" }]);
    expect(await t.run()).toEqual([{ event_id: rally!.id, result: "checked", stages: 1, doc_url: "https://r.example/divaci.html" }]);
  });
});

describe("Workers AI image input", () => {
  it("sends an image as image_url next to the text", async () => {
    const runs: Record<string, unknown>[] = [];
    const ai: AiBinding = {
      run: async (_m, inputs) => {
        runs.push(inputs);
        return { response: { stages: [] } };
      },
      toMarkdown: async () => ({ format: "markdown", data: "" }),
    };
    const { StagesSchema } = await import("../src/pipeline/stages.ts");
    await workersAiModel(ai, "m").json({
      system: "s",
      content: [{ type: "image", data: new Uint8Array([1, 2, 3]), mediaType: "image/png" }, { type: "text", text: "Závod: X" }],
      schema: StagesSchema,
      maxTokens: 100,
      effort: "low",
    });
    const user = (runs[0]!.messages as { content: unknown }[])[1]!;
    expect(user.content).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
      { type: "text", text: "Závod: X" },
    ]);
  });
});
