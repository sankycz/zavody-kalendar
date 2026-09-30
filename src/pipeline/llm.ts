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
    // Long lists time out (3046) or get cut short in one call; ~15 table rows per call is safe.
    blockChars: 1200,
    pdfToText,
    async json(req) {
      const parts: string[] = [];
      for (const c of req.content) {
        parts.push(c.type === "text" ? c.text : `<source>\n${await pdfToText(c.data)}\n</source>`);
      }
      let out: WorkersAiOutput;
      try {
        out = (await ai.run(model, {
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: parts.join("\n\n") },
          ],
          response_format: { type: "json_schema", json_schema: z.toJSONSchema(req.schema) },
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
          value = JSON.parse(value);
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
