// Run the real Claude extraction over the fixtures saved in fixtures/<provider>/
// (<id>.txt for html sources, <id>.pdf for pdf sources) and store the model
// output as fixtures/<provider>/<id>.extraction.json, so tests can run
// normalization + dedupe over real model output without calling the API.
// Usage: ANTHROPIC_API_KEY=… CLAUDE_MODEL=… npm run fixtures:extract [provider|source-id]
//   CLAUDE_MODEL defaults to the value in wrangler.jsonc.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { extractEvents } from "../src/pipeline/extract.ts";
import { processExtraction } from "../src/pipeline/run.ts";

const SEASON = 2026;
const SOURCES = [
  { id: "autoklub-cal-pdf-2026", provider: "autoklub-cal", name: "Autoklub ČR – kalendář (PDF)", kind: "pdf" },
  { id: "autoklub-cal-html-2026", provider: "autoklub-cal", name: "Autoklub ČR – kalendář", kind: "html" },
  { id: "autokaleidoskop-2026", provider: "autokaleidoskop", name: "Autokaleidoskop – kalendář závodů", kind: "html" },
  { id: "edda-2026", provider: "edda", name: "Edda Cup – tratě", kind: "html" },
] as const;

const root = join(import.meta.dirname, "..");
const only = process.argv.slice(2).find((a) => !a.startsWith("--"));
const selected = SOURCES.filter((s) => !only || s.id === only || s.provider === only);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY");
const model =
  process.env.CLAUDE_MODEL ?? /"CLAUDE_MODEL"\s*:\s*"([^"]+)"/.exec(readFileSync(join(root, "wrangler.jsonc"), "utf8"))?.[1];
if (!model) throw new Error("Set CLAUDE_MODEL");
const client = new Anthropic({ apiKey });

for (const s of selected) {
  const dir = join(root, "fixtures", s.provider);
  const input = join(dir, `${s.id}.${s.kind === "pdf" ? "pdf" : "txt"}`);
  if (!existsSync(input)) {
    console.error(`skip ${s.id}: ${input} not found`);
    continue;
  }
  try {
    const out = await extractEvents(client, model, {
      sourceName: s.name,
      season: SEASON,
      kind: s.kind,
      ...(s.kind === "pdf" ? { pdf: new Uint8Array(readFileSync(input)) } : { text: readFileSync(input, "utf8") }),
    });
    const file = {
      _note: `Reálný výstup modelu ${model} nad ${s.id}.${s.kind === "pdf" ? "pdf" : "txt"} (npm run fixtures:extract).`,
      source_id: s.id,
      season: SEASON,
      model,
      extracted_at: new Date().toISOString().slice(0, 10),
      usage: out.usage,
      events: out.items,
    };
    writeFileSync(join(dir, `${s.id}.extraction.json`), JSON.stringify(file, null, 2) + "\n");
    const batch = processExtraction(out.items, SEASON);
    console.log(
      `ok   ${s.id}: ${out.items.length} extracted, ${batch.events.length} valid after dedupe, ${batch.invalid.length} invalid ` +
        `(${out.usage.input_tokens} in / ${out.usage.output_tokens} out tokens)`,
    );
    for (const bad of batch.invalid) console.log(`     invalid: ${bad.error}`);
  } catch (err) {
    console.error(`fail ${s.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
