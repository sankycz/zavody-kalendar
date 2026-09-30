import { describe, expect, it } from "vitest";
import { extractEvents, lineBlocks } from "../src/pipeline/extract.ts";
import { ModelError, workersAiModel, type AiBinding } from "../src/pipeline/llm.ts";
import { OrganizerCheckSchema } from "../src/pipeline/organizer.ts";

function fakeAi(response: unknown, opts: { fail?: string; markdown?: string } = {}) {
  const runs: { model: string; inputs: Record<string, unknown> }[] = [];
  const converted: string[] = [];
  const ai: AiBinding = {
    run: async (model, inputs) => {
      runs.push({ model, inputs });
      if (opts.fail) throw new Error(opts.fail);
      return { response, usage: { prompt_tokens: 10, completion_tokens: 5 } };
    },
    toMarkdown: async (file) => {
      converted.push(file.name);
      return { format: "markdown", data: opts.markdown ?? "" };
    },
  };
  return { ai, runs, converted };
}

const item = { name: "Rallye X", date_from: "2026-05-22", discipline: "rally" };

describe("workersAiModel", () => {
  it("sends the prompt, the configured model and a JSON schema; returns the items", async () => {
    const { ai, runs } = fakeAi({ events: [item] });
    const out = await extractEvents(workersAiModel(ai, "@cf/test/model"), { sourceName: "X", season: 2026, kind: "html", text: "radek" });
    expect(out).toEqual({ items: [item], usage: { input_tokens: 10, output_tokens: 5 } });
    const { model, inputs } = runs[0]!;
    expect(model).toBe("@cf/test/model");
    expect((inputs.response_format as { type: string }).type).toBe("json_schema");
    const [system, user] = inputs.messages as { role: string; content: string }[];
    expect(system!.content).toContain("automobilových závodů");
    expect(user!.content).toContain("<source>\nradek\n</source>");
  });

  it("accepts the answer as a JSON string and keeps items that break the schema (normalizeEvent skips them later)", async () => {
    const { ai } = fakeAi(JSON.stringify({ events: [item, { name: "Motokáry", discipline: "motokáry" }] }));
    const out = await extractEvents(workersAiModel(ai, "m"), { sourceName: "X", season: 2026, kind: "html", text: "t" });
    expect(out.items).toHaveLength(2);
  });

  it("converts a PDF to text with the binding first (Workers AI takes no PDF input)", async () => {
    const { ai, runs, converted } = fakeAi({ events: [] }, { markdown: "| 22.5. | Rallye X |" });
    await extractEvents(workersAiModel(ai, "m"), { sourceName: "X", season: 2026, kind: "pdf", pdf: new Uint8Array([37]) });
    expect(converted).toEqual(["source.pdf"]);
    expect((runs[0]!.inputs.messages as { content: string }[])[1]!.content).toContain("| 22.5. | Rallye X |");
  });

  it.each([
    [fakeAi("not json {").ai, /not JSON/],
    [fakeAi({ items: [] }).ai, /schema/],
    [fakeAi(null, { fail: "3040: Out of capacity" }).ai, /Out of capacity/],
  ])("throws ModelError on bad output or a failed call (%#)", async (ai, re) => {
    const run = extractEvents(workersAiModel(ai, "m"), { sourceName: "X", season: 2026, kind: "html", text: "t" });
    await expect(run).rejects.toThrow(ModelError);
    await expect(extractEvents(workersAiModel(ai, "m"), { sourceName: "X", season: 2026, kind: "html", text: "t" })).rejects.toThrow(re);
  });

  it("validates strictly where no looser schema is given (organizer check)", async () => {
    const { ai } = fakeAi({ mentions_event: "yes" });
    await expect(
      workersAiModel(ai, "m").json({ system: "s", content: [{ type: "text", text: "t" }], schema: OrganizerCheckSchema, maxTokens: 100, effort: "low" }),
    ).rejects.toThrow(/schema/);
  });

  it("sends a long source in line blocks with the whole numbered text as context", async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `${i + 1}.5. | Závod ${i + 1} | ●`);
    const { ai, runs } = fakeAi({ events: [item] });
    const out = await extractEvents(workersAiModel(ai, "m"), { sourceName: "X", season: 2026, kind: "html", text: lines.join("\n") });
    expect(runs.length).toBeGreaterThan(1);
    expect(out.items).toHaveLength(runs.length);
    expect(out.usage).toEqual({ input_tokens: 10 * runs.length, output_tokens: 5 * runs.length });
    expect(out.failedBlocks).toBeUndefined();
    const user = (r: (typeof runs)[number]) => (r.inputs.messages as { content: string }[])[1]!.content;
    expect(user(runs[0]!)).toContain("300: 300.5. | Závod 300 | ●");
    expect(user(runs[0]!)).toMatch(/na řádcích 1–\d+\./);
    expect(user(runs.at(-1)!)).toMatch(/na řádcích \d+–300\./);
  });

  it("retries a failed block once and reports blocks that still fail", async () => {
    const text = Array.from({ length: 200 }, (_, i) => `řádek ${i} ${"x".repeat(20)}`).join("\n");
    let calls = 0;
    const ai: AiBinding = {
      run: async (_m, inputs) => {
        calls++;
        const user = (inputs.messages as { content: string }[])[1]!.content;
        if (/na řádcích 1–/.test(user)) throw new Error("3046: Request timeout");
        return { response: { events: [item] } };
      },
      toMarkdown: async () => ({ format: "markdown", data: "" }),
    };
    const out = await extractEvents(workersAiModel(ai, "m"), { sourceName: "X", season: 2026, kind: "html", text });
    const blocks = lineBlocks(text.split("\n"), 1200).length;
    expect(calls).toBe(blocks + 1);
    expect(out.items).toHaveLength(blocks - 1);
    expect(out.failedBlocks).toEqual([expect.stringMatching(/^1–\d+: Workers AI: 3046: Request timeout$/)]);
  });

  it("fails when every block fails", async () => {
    const text = Array.from({ length: 200 }, (_, i) => `řádek ${i} ${"x".repeat(20)}`).join("\n");
    const { ai } = fakeAi(null, { fail: "3046: Request timeout" });
    await expect(extractEvents(workersAiModel(ai, "m"), { sourceName: "X", season: 2026, kind: "html", text })).rejects.toThrow(/all \d+ blocks failed/);
  });
});

describe("lineBlocks", () => {
  it("covers every line once, in order, within the size limit", () => {
    const lines = ["a".repeat(50), "b".repeat(50), "c".repeat(50), "d".repeat(200), "e"];
    expect(lineBlocks(lines, 110)).toEqual([
      { from: 1, to: 2 },
      { from: 3, to: 3 },
      { from: 4, to: 4 },
      { from: 5, to: 5 },
    ]);
    expect(lineBlocks([], 100)).toEqual([]);
  });
});
