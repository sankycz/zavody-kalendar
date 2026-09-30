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
- country: ISO kód země konání (CZ, AT, SK, DE, PL…). Závody českých seriálů v zahraničí zahrň.
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

/** Send one source to the model and get back the raw (not yet validated) items. */
export async function extractEvents(llm: JsonModel, input: ExtractInput): Promise<ExtractOutput> {
  const out = await llm.json({
    system: SYSTEM_PROMPT,
    content: buildUserContent(input),
    schema: ExtractionSchema,
    accept: ExtractionEnvelope,
    maxTokens: 64000,
    effort: "medium",
  });
  return { items: out.data.events, usage: out.usage };
}
