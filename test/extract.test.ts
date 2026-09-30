import { describe, expect, it } from "vitest";
import { buildUserContent, extractEvents, ExtractionError, type MessagesClient } from "../src/pipeline/extract.ts";

function fakeClient(message: Record<string, unknown>) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      stream: (params: Record<string, unknown>) => {
        calls.push(params);
        return { finalMessage: async () => message };
      },
    },
  } as unknown as MessagesClient;
  return { client, calls };
}

const okMessage = {
  stop_reason: "end_turn",
  parsed_output: { events: [{ name: "A" }] },
  usage: { input_tokens: 100, output_tokens: 20 },
};

describe("extractEvents", () => {
  it("uses the configured model, structured output and a document block for PDFs", async () => {
    const { client, calls } = fakeClient(okMessage);
    const out = await extractEvents(client, "model-from-env", {
      sourceName: "Autoklub",
      season: 2026,
      kind: "pdf",
      pdf: new Uint8Array([37, 80, 68, 70]),
    });
    expect(out.items).toEqual([{ name: "A" }]);
    const p = calls[0]!;
    expect(p.model).toBe("model-from-env");
    expect((p.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    const content = (p.messages as { content: { type: string; source?: { data: string } }[] }[])[0]!.content;
    expect(content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf", data: "JVBERg==" } });
  });

  it("wraps HTML text in a source block", () => {
    const content = buildUserContent({ sourceName: "X", season: 2026, kind: "html", text: "radek" });
    expect(content[0]).toEqual({ type: "text", text: "<source>\nradek\n</source>" });
  });

  it.each([
    [{ ...okMessage, stop_reason: "refusal", stop_details: { category: "cyber" } }, /refused/],
    [{ ...okMessage, stop_reason: "max_tokens" }, /max_tokens/],
    [{ ...okMessage, parsed_output: null }, /schema/],
  ])("throws on %#", async (message, re) => {
    const { client } = fakeClient(message);
    await expect(extractEvents(client, "m", { sourceName: "X", season: 2026, kind: "html", text: "t" })).rejects.toThrow(
      ExtractionError,
    );
    await expect(extractEvents(client, "m", { sourceName: "X", season: 2026, kind: "html", text: "t" })).rejects.toThrow(re);
  });
});
