import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * One structured-output call: system prompt + user content in, JSON matching
 * `schema` out. Two backends, picked by EXTRACTOR in wrangler.jsonc:
 * Claude API (claude) and Cloudflare Workers AI (workers-ai).
 */
export type ContentPart = { type: "text"; text: string } | { type: "pdf"; data: Uint8Array };

export interface JsonRequest<S extends z.ZodType> {
  system: string;
  content: ContentPart[];
  schema: S;
  /**
   * What the answer must satisfy to be returned (default: `schema`). Looser
   * for extraction, so one bad item doesn't sink the batch: items are then
   * validated one by one by normalizeEvent.
   */
  accept?: z.ZodType;
  maxTokens: number;
  effort: "low" | "medium";
}

export interface JsonResult<T> {
  data: T;
  usage: { input_tokens: number; output_tokens: number };
}

export interface JsonModel {
  json<S extends z.ZodType>(req: JsonRequest<S>): Promise<JsonResult<z.infer<S>>>;
  /**
   * Set for models with a small, slow output (Workers AI): extraction then
   * sends the source in blocks of about this many characters (see extract.ts).
   */
  readonly blockChars?: number;
  /** Text of a PDF, for models without PDF input. */
  pdfToText?(pdf: Uint8Array): Promise<string>;
}

export class ModelError extends Error {}

export type MessagesClient = Pick<Anthropic, "messages">;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function claudeModel(client: MessagesClient, model: string): JsonModel {
  return {
    async json(req) {
      const stream = client.messages.stream({
        model,
        max_tokens: req.maxTokens,
        system: req.system,
        output_config: { effort: req.effort, format: zodOutputFormat(req.schema) },
        messages: [
          {
            role: "user",
            content: req.content.map((c): Anthropic.ContentBlockParam =>
              c.type === "pdf"
                ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(c.data) } }
                : { type: "text", text: c.text },
            ),
          },
        ],
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") {
        throw new ModelError(`model refused (${message.stop_details?.category ?? "unknown"})`);
      }
      if (message.stop_reason === "max_tokens") {
        throw new ModelError("output hit max_tokens; source is too large for one request");
      }
      if (message.parsed_output == null) throw new ModelError("model output did not match the schema");
      return {
        data: message.parsed_output as z.infer<typeof req.schema>,
        usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
      };
    },
  };
}

/** Output format for models without guided decoding. */
export function jsonInstruction(schema: z.ZodType): string {
  return (
    "Odpověz jen jedním JSON objektem podle tohoto JSON Schema, bez dalšího textu a bez markdownu:\n" +
    JSON.stringify(z.toJSONSchema(schema))
  );
}

/** "```json\n{...}\n```" -> "{...}" */
export function stripFences(s: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/.exec(s);
  return m ? m[1]! : s;
}

/** The part of the Workers AI binding (env.AI) we use. */
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
  toMarkdown(file: { name: string; blob: Blob }): Promise<{ format: string; data?: string; error?: string }>;
}

interface WorkersAiOutput {
  response?: unknown;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Workers AI in JSON mode. It has no PDF input, so a PDF is first converted to
 * text by the binding's Markdown Conversion. The model isn't guaranteed to
 * follow the schema, so the answer is validated here like any other.
 */
export function workersAiModel(ai: AiBinding, model: string): JsonModel {
  const pdfToText = async (pdf: Uint8Array): Promise<string> => {
    const md = await ai.toMarkdown({ name: "source.pdf", blob: new Blob([pdf], { type: "application/pdf" }) });
    if (md.format === "error" || md.data == null) throw new ModelError(`PDF conversion failed: ${md.error ?? "no text"}`);
    return md.data;
  };
  return {
    // Long lists time out (3046) or get cut short in one call; ~40 table rows per call is safe.
    blockChars: 3000,
    pdfToText,
    async json(req) {
      const parts: string[] = [];
      for (const c of req.content) {
        parts.push(c.type === "text" ? c.text : `<source>\n${await pdfToText(c.data)}\n</source>`);
      }
      let out: WorkersAiOutput;
      try {
        out = (await ai.run(model, {
          // Schema in the prompt, not response_format: guided JSON decoding on
          // Workers AI is several times slower and long lists then time out (3046).
          messages: [
            { role: "system", content: `${req.system}\n\n${jsonInstruction(req.schema)}` },
            { role: "user", content: parts.join("\n\n") },
          ],
          // Workers AI models have far smaller context windows than Claude.
          max_tokens: Math.min(req.maxTokens, 16_000),
          temperature: 0,
        })) as WorkersAiOutput;
      } catch (err) {
        throw new ModelError(`Workers AI: ${err instanceof Error ? err.message : String(err)}`);
      }
      let value = out.response;
      if (typeof value === "string") {
        try {
          value = JSON.parse(stripFences(value));
        } catch {
          throw new ModelError("model output is not JSON");
        }
      }
      const parsed = (req.accept ?? req.schema).safeParse(value);
      if (!parsed.success) throw new ModelError("model output did not match the schema");
      return {
        data: parsed.data as z.infer<typeof req.schema>,
        usage: { input_tokens: out.usage?.prompt_tokens ?? 0, output_tokens: out.usage?.completion_tokens ?? 0 },
      };
    },
  };
}
