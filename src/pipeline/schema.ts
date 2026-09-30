import { z } from "zod";

export const DISCIPLINES = [
  "rally",
  "rallysprint",
  "vrch",
  "autocross",
  "slalom",
  "okruh",
  "drift",
  "regularity",
  "historic",
  "jiny",
] as const;
export const LEVELS = ["mcr", "pohar", "regionalni", "volny"] as const;
export const STATUSES = ["planned", "cancelled", "finished"] as const;

export type Discipline = (typeof DISCIPLINES)[number];
export type Level = (typeof LEVELS)[number];
export type Status = (typeof STATUSES)[number];

/**
 * Shape the model must return (structured output). Deliberately loose on
 * dates and free text: the model copies what the source says and our own
 * normalization decides what is valid, item by item.
 */
export const ExtractedEventSchema = z.object({
  name: z.string().describe("Název závodu tak, jak je ve zdroji"),
  date_from: z
    .string()
    .describe("Datum začátku, ideálně YYYY-MM-DD; pokud si nejsi jistý, zkopíruj text ze zdroje"),
  date_to: z.string().nullable().describe("Datum konce u vícedenních závodů, jinak null"),
  discipline: z.enum(DISCIPLINES),
  series: z.string().nullable().describe("Seriál / šampionát, např. 'MČR v rallye', 'Edda Cup'"),
  level: z.enum(LEVELS),
  location_name: z.string().nullable().describe("Název obce, kde se závod jede (ne název trati ani klubu)"),
  region: z.string().nullable().describe("Kraj, pokud ho zdroj uvádí, jinak null"),
  country: z.string().describe("ISO 3166-1 alpha-2, např. CZ, AT, SK"),
  organizer: z.string().nullable().describe("Pořadatel (autoklub / spolek), žádné osoby"),
  website_url: z.string().nullable().describe("Web závodu nebo pořadatele, pokud je ve zdroji"),
  description: z.string().nullable().describe("Krátká poznámka ze zdroje (max. 1–2 věty), jinak null"),
  status: z.enum(STATUSES),
  raw_excerpt: z.string().describe("Doslovný řádek / úsek zdroje, ze kterého položka vznikla"),
});
export type ExtractedEvent = z.infer<typeof ExtractedEventSchema>;

export const ExtractionSchema = z.object({
  events: z.array(ExtractedEventSchema),
});

/** A validated, normalized event ready for dedupe and upsert. */
export interface NormalizedEvent {
  name: string;
  date_from: string;
  date_to: string | null;
  discipline: Discipline;
  series: string | null;
  level: Level;
  location_name: string | null;
  region: string | null;
  country: string;
  organizer: string | null;
  website_url: string | null;
  description: string | null;
  status: Status;
  raw_excerpt: string | null;
  dedupe_key: string;
}

export interface SourceRow {
  id: string;
  provider: string;
  name: string;
  url: string;
  season: number;
  kind: "html" | "pdf" | "facebook";
  priority: number;
  last_fetched_at: string | null;
  last_content_hash: string | null;
  enabled: number;
}
