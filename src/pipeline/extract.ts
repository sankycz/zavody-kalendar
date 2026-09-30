import { z } from "zod";
import { ModelError, type ContentPart, type JsonModel } from "./llm.ts";
import { ExtractionSchema } from "./schema.ts";

export { ModelError as ExtractionError, type MessagesClient } from "./llm.ts";

export const SYSTEM_PROMPT = `Jsi extraktor dat pro kalendář automobilových závodů v České republice.
Dostaneš obsah jednoho zdroje (HTML text nebo PDF s kalendářem). Vrať VŠECHNY automobilové závody, které v něm jsou, jako pole "events".

Pravidla:
- Jen automobilové disciplíny. Motocykly, motokáry, čtyřkolky, truck trial a nemotoristické akce vynech.
- Jen závody uvedené sezóny; starší ročníky na stejné stránce vynech.
- Akce, které nejsou závod (volné jízdy, testování, pronájem okruhu, kurzy, výstavy, vyhlášení výsledků), vynech.
- Každý termín závodu je jedna položka. Vícedenní závod = jedna položka s date_from a date_to.
- date_from / date_to: převeď na YYYY-MM-DD. Když zdroj uvádí jen den a měsíc, doplň rok sezóny. Když datum nejde jednoznačně určit (překlep, chybějící měsíc), zkopíruj text ze zdroje beze změny — nevymýšlej ho.
- discipline: rally, rallysprint, vrch (závody do vrchu), autocross (i rallycross), slalom (autoslalom), okruh, drift, regularity, historic (závody historických vozidel, když nejde o jinou disciplínu), jiny.
- level:
  - mcr = mistrovství ČR (MČR), i když je závod zároveň součástí zahraničního šampionátu,
  - pohar = seriály, poháry, série, trofeje (např. RSS, Edda Cup, Triola Cup),
  - regionalni = oblastní a regionální přebory,
  - volny = volný závod bez seriálu.
  Když zdroj uvádí víc úrovní, vyber nejvyšší (mcr > pohar > regionalni > volny).
- series: název seriálu / šampionátu tak, jak je ve zdroji, jinak null.
- location_name: název obce, kde se jede (u rally sídlo / centrum rally, u okruhu obec, kde okruh leží). Ne název trati, okruhu ani klubu. Když obec ve zdroji chybí, ale místo konání je jednoznačně známé (např. Red Bull Ring → Spielberg, Barum Czech Rally Zlín → Zlín), doplň ji. Když obec nejde jednoznačně určit, null — takový závod se do kalendáře nezapíše.
- Jen závody konané v České republice. Závody v zahraničí vynech, i když patří do českého seriálu.
- country: ISO kód země konání (CZ; u závodu v zahraničí, pokud ho přesto vrátíš, jeho kód: AT, SK, DE, PL…).
- organizer: pořadatelský klub / spolek. Nikdy nevypisuj jména osob (jezdců, ředitelů, kontaktních osob) v žádném poli.
- website_url: jen URL, které je přímo ve zdroji. Nevymýšlej je.
- status: cancelled, pokud zdroj uvádí zrušeno / odloženo bez náhradního termínu; jinak planned.
- description: krátká faktická poznámka ze zdroje (např. "předběžný termín"), jinak null.
- raw_excerpt: doslovný úsek zdroje (jeden řádek tabulky / odstavec), ze kterého položka vznikla.
- Nic si nedomýšlej. Co ve zdroji není, je null.`;

export interface ExtractInput {
  sourceName: string;
  season: number;
  kind: "html" | "pdf";
  /** Plain text for html sources. */
  text?: string;
  /** Raw PDF bytes for pdf sources. */
  pdf?: Uint8Array;
}

export interface ExtractOutput {
  items: unknown[];
  usage: { input_tokens: number; output_tokens: number };
  /** Blocks whose call failed (block mode only); their rows are missing from `items`. */
  failedBlocks?: string[];
}

export function buildUserContent(input: ExtractInput): ContentPart[] {
  const instruction: ContentPart = {
    type: "text",
    text: `Zdroj: ${input.sourceName}\nSezóna: ${input.season}\nVytáhni všechny automobilové závody podle pravidel.`,
  };
  if (input.kind === "pdf") {
    if (!input.pdf) throw new ModelError("pdf source without pdf bytes");
    return [{ type: "pdf", data: input.pdf }, instruction];
  }
  if (!input.text) throw new ModelError("html source without text");
  return [{ type: "text", text: `<source>\n${input.text}\n</source>` }, instruction];
}

/** Items are validated one by one later (normalizeEvent), so only the envelope must hold. */
const ExtractionEnvelope = z.object({ events: z.array(z.unknown()) });

export interface LineBlock {
  /** 1-based, inclusive. */
  from: number;
  to: number;
}

/** Split lines into consecutive blocks of at most `maxChars` (a longer single line is its own block). */
export function lineBlocks(lines: string[], maxChars: number): LineBlock[] {
  const blocks: LineBlock[] = [];
  let from = 1;
  let size = 0;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (size > 0 && size + line.length + 1 > maxChars) {
      blocks.push({ from, to: n - 1 });
      from = n;
      size = 0;
    }
    size += line.length + 1;
  });
  if (lines.length > 0) blocks.push({ from, to: lines.length });
  return blocks;
}

/** Content for one block: the whole numbered source as context, rows to extract given by line range. */
export function buildBlockContent(input: ExtractInput, numbered: string, block: LineBlock): ContentPart[] {
  return [
    { type: "text", text: `<source>\n${numbered}\n</source>` },
    {
      type: "text",
      text:
        `Zdroj: ${input.sourceName}\nSezóna: ${input.season}\n` +
        `Zdroj má očíslované řádky. Vytáhni podle pravidel jen závody, které jsou na řádcích ${block.from}–${block.to}. ` +
        `Ostatní řádky ber jen jako kontext (nadpisy sekcí, hlavičky tabulek, vysvětlivky); závody z nich nevracej. ` +
        `Do raw_excerpt zkopíruj řádek bez čísla řádku.`,
    },
  ];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const request = (content: ContentPart[]) => ({
  system: SYSTEM_PROMPT,
  content,
  schema: ExtractionSchema,
  accept: ExtractionEnvelope,
  maxTokens: 64000,
  effort: "medium" as const,
});

/** Parallel calls in block mode. */
const BLOCK_CONCURRENCY = 3;

/**
 * Send one source to the model and get back the raw (not yet validated) items.
 * Models with `blockChars` get a longer source in line blocks, one call each
 * (retried once); the items of all blocks are concatenated.
 */
export async function extractEvents(llm: JsonModel, input: ExtractInput): Promise<ExtractOutput> {
  let text = input.text;
  if (llm.blockChars && input.kind === "pdf" && llm.pdfToText) {
    if (!input.pdf) throw new ModelError("pdf source without pdf bytes");
    text = await llm.pdfToText(input.pdf);
  }
  if (!llm.blockChars || text == null || text.length <= llm.blockChars) {
    const content = text != null ? buildUserContent({ ...input, kind: "html", text }) : buildUserContent(input);
    const out = await llm.json(request(content));
    return { items: out.data.events, usage: out.usage };
  }

  const lines = text.split("\n");
  const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join("\n");
  const blocks = lineBlocks(lines, llm.blockChars);
  const results = await mapLimit(blocks, BLOCK_CONCURRENCY, async (block) => {
    const call = () => llm.json(request(buildBlockContent(input, numbered, block)));
    try {
      return { block, out: await call().catch(call) };
    } catch (err) {
      return { block, error: err instanceof Error ? err.message : String(err) };
    }
  });

  const failed = results.filter((r) => "error" in r);
  if (failed.length === results.length) throw new ModelError(`all ${results.length} blocks failed: ${failed[0]!.error}`);
  const items: unknown[] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  for (const r of results) {
    if (!r.out) continue;
    items.push(...r.out.data.events);
    usage.input_tokens += r.out.usage.input_tokens;
    usage.output_tokens += r.out.usage.output_tokens;
  }
  return {
    items,
    usage,
    ...(failed.length ? { failedBlocks: failed.map((r) => `${r.block.from}–${r.block.to}: ${r.error}`) } : {}),
  };
}
