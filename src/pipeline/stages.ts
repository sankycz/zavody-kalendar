import { z } from "zod";
import { decodeHtml } from "./decode.ts";
import { htmlToText } from "./htmlToText.ts";
import { sha256Hex, type PoliteClient } from "./http.ts";
import type { ContentPart, ImageType, JsonModel } from "./llm.ts";
import { parseDate } from "./normalize.ts";
import type { LinkKind } from "./schema.ts";

/**
 * Stages (RZ) and road closures of rallies and hill climbs, read from the
 * organizer's documents for spectators. Navigation apps don't know the closed
 * roads; the race detail lists the stages only when a document gives them.
 * Only stage names and times are stored (never names of people), not the documents.
 */

/** Disciplines raced on public roads closed for the race (same as web/src/closures.ts). */
export const STAGE_DISCIPLINES = ["rally", "rallysprint", "vrch"] as const;
/** Documents read, best first (a timetable has the stage times; spectator info the closures). */
export const STAGE_DOC_KINDS: readonly LinkKind[] = ["harmonogram", "divaci", "propozice", "mapa"];
export const MAX_STAGE_DOCS = 3;
export const DEFAULT_STAGE_LIMIT = 5;
const MAX_TEXT_CHARS = 60_000;
const MAX_PDF_BYTES = 15 * 1024 * 1024;
/** Claude takes images up to 5 MB. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_STAGES = 40;

const IMAGE_TYPES: readonly ImageType[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Fields may be missing (Workers AI leaves out nulls), so nullish, not nullable.
const StageItemSchema = z.object({
  name: z.string().describe("Označení a název zkoušky jak je v dokumentu, např. „RZ 1 Vrčeňská 1“"),
  date: z.string().nullish().describe("Den průjezdu YYYY-MM-DD, jinak null"),
  first_car: z.string().nullish().describe("Start prvního vozu do zkoušky HH:MM, jen když je v dokumentu"),
  closed_from: z.string().nullish().describe("Uzavření silnice HH:MM, jen když ho dokument výslovně uvádí"),
  closed_to: z.string().nullish().describe("Otevření silnice HH:MM, jen když ho dokument výslovně uvádí"),
  length_km: z.number().nullish().describe("Délka zkoušky v km, jinak null"),
});
export const StagesSchema = z.object({ stages: z.array(StageItemSchema) });
export type StageItem = z.infer<typeof StageItemSchema>;

export const STAGES_PROMPT = `Čteš dokument pořadatele automobilového závodu v ČR (harmonogram, informace pro diváky, propozice, mapu). Vypiš rychlostní zkoušky (RZ, SS, měřené úseky, shakedown), u závodu do vrchu trať, a to jen s časy, které dokument opravdu uvádí. Diváci podle toho plánují cestu, protože silnice na trati jsou uzavřené.

Pravidla:
- Jedna položka = jeden průjezd zkoušky (RZ 1, RZ 2…), v pořadí podle dokumentu. Přejezdy, servisy, časové kontroly, přejímky a vyhlášení nevracej.
- name: označení a název zkoušky jak je v dokumentu, např. „RZ 1 Vrčeňská 1“. Žádná jména osob.
- date: den průjezdu YYYY-MM-DD podle dokumentu; když dokument uvádí jen jeden den závodu, ten den; jinak null.
- first_car: čas startu prvního vozu do zkoušky (HH:MM), jen když je v dokumentu, jinak null.
- closed_from / closed_to: čas uzavření a otevření silnice pro tuto zkoušku (HH:MM), jen když dokument uzavírku výslovně uvádí. Nedopočítávej je ze startu prvního vozu.
- length_km: délka zkoušky v km, když je uvedena, jinak null.
- Když dokument žádné zkoušky s časy neobsahuje, vrať {"stages": []}. Nic si nedomýšlej.`;

export interface Stage {
  name: string;
  date: string | null;
  first_car: string | null;
  closed_from: string | null;
  closed_to: string | null;
  length_km: number | null;
}

/** "8.35", "08:35", "8:35 hod." -> "08:35"; anything else null. */
export function parseTime(input: string | null | undefined): string | null {
  const m = /^\s*(\d{1,2})\s*[:.]\s*(\d{2})(?:\s*(?:h|hod)\.?)?\s*$/i.exec(input ?? "");
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
}

/** Is the time written in the text (8:35, 08:35, 8.35)? Models make times up. */
function timeInText(t: string, text: string): boolean {
  const [h, m] = t.split(":") as [string, string];
  const hours = h.startsWith("0") ? [h, h.slice(1)] : [h];
  return hours.some((hh) => new RegExp(`(^|[^\\d])${hh}\\s*[:.]\\s*${m}(?!\\d)`).test(text));
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Validate the model's stages: real times, dates within the race (the day before
 * for a shakedown), at least one time per stage. With the document's text at hand
 * every time must be in it. Invalid items are skipped (reported in `skipped`).
 */
export function normalizeStages(
  e: { date_from: string; date_to: string | null },
  raw: unknown[],
  text?: string,
): { stages: Stage[]; skipped: string[] } {
  const season = Number(e.date_from.slice(0, 4));
  const last = e.date_to ?? e.date_from;
  const stages: Stage[] = [];
  const skipped: string[] = [];
  for (const r of raw) {
    const p = StageItemSchema.safeParse(r);
    if (!p.success) {
      skipped.push("invalid item");
      continue;
    }
    const s = p.data;
    const name = s.name.replace(/\s+/g, " ").trim().slice(0, 80);
    let date = parseDate(s.date, season);
    if (date && (date < addDays(e.date_from, -1) || date > last)) date = null;
    if (!date && e.date_to == null) date = e.date_from;
    let [first_car, closed_from, closed_to] = [parseTime(s.first_car), parseTime(s.closed_from), parseTime(s.closed_to)];
    if (text != null) {
      [first_car, closed_from, closed_to] = [first_car, closed_from, closed_to].map((t) => (t && timeInText(t, text) ? t : null)) as [
        string | null,
        string | null,
        string | null,
      ];
    }
    if (!closed_from) closed_to = null;
    if (!name || (!first_car && !closed_from)) {
      skipped.push(`no name or time: ${name || "?"}`);
      continue;
    }
    const km = s.length_km;
    stages.push({ name, date, first_car, closed_from, closed_to, length_km: km != null && km > 0 && km < 100 ? km : null });
  }
  stages.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.first_car ?? a.closed_from ?? "").localeCompare(b.first_car ?? b.closed_from ?? ""));
  return { stages: stages.slice(0, MAX_STAGES), skipped };
}

/** A fetched document as model input; `text` when we have it (for the time check). */
interface Doc {
  url: string;
  bytes: Uint8Array;
  content: ContentPart;
  text?: string;
}

async function fetchDoc(http: PoliteClient, llm: JsonModel, url: string): Promise<Doc | null> {
  const res = await http.get(url);
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }
  const type = (res.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
  const image = IMAGE_TYPES.find((t) => t === type);
  const isPdf = type === "application/pdf";
  if (!image && !isPdf && !/html|text\/plain/.test(type)) {
    await res.body?.cancel();
    return null;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (image) return bytes.byteLength > MAX_IMAGE_BYTES ? null : { url, bytes, content: { type: "image", data: bytes, mediaType: image } };
  if (isPdf) {
    if (bytes.byteLength > MAX_PDF_BYTES) return null;
    // Models without PDF input (Workers AI) get the text, which then also checks the times.
    if (llm.pdfToText) {
      const text = (await llm.pdfToText(bytes)).slice(0, MAX_TEXT_CHARS);
      return { url, bytes, text, content: { type: "text", text: `<document>\n${text}\n</document>` } };
    }
    return { url, bytes, content: { type: "pdf", data: bytes } };
  }
  const text = htmlToText(decodeHtml(bytes, res.headers.get("Content-Type") ?? ""), url).slice(0, MAX_TEXT_CHARS);
  return { url, bytes, text, content: { type: "text", text: `<document>\n${text}\n</document>` } };
}

export interface StageDeps {
  db: D1Database;
  http: PoliteClient;
  llm: JsonModel;
  log?: (msg: string) => void;
}

interface DueRace {
  id: string;
  name: string;
  date_from: string;
  date_to: string | null;
  discipline: string;
  website_url: string | null;
  prev_hash: string | null;
}

export type StageReport =
  | { event_id: string; result: "no_documents" | "unchanged" }
  | { event_id: string; result: "error"; error: string }
  | { event_id: string; result: "checked"; stages: number; doc_url: string | null };

/** Upcoming rallies and hill climbs not read today, never-read and soonest first. */
export async function dueRaces(db: D1Database, today: string, limit: number, windowDays: number): Promise<DueRace[]> {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.name, e.date_from, e.date_to, e.discipline, e.website_url, sc.content_hash AS prev_hash
         FROM events e LEFT JOIN stage_checks sc ON sc.event_id = e.id
        WHERE e.status = 'planned'
          AND e.discipline IN (${STAGE_DISCIPLINES.map(() => "?").join(", ")})
          AND COALESCE(e.date_to, e.date_from) >= ?
          AND e.date_from <= ?
          AND (sc.checked_at IS NULL OR substr(sc.checked_at, 1, 10) < ?)
        ORDER BY sc.checked_at IS NOT NULL, e.date_from, sc.checked_at
        LIMIT ?`,
    )
    .bind(...STAGE_DISCIPLINES, today, addDays(today, windowDays), today, limit)
    .all<DueRace>();
  return results;
}

/** The race's documents to read: linked documents by kind, then the organizer's page. */
async function candidateUrls(db: D1Database, e: DueRace): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT url, kind FROM event_links WHERE event_id = ? AND kind IN (${STAGE_DOC_KINDS.map(() => "?").join(", ")}) ORDER BY position`,
    )
    .bind(e.id, ...STAGE_DOC_KINDS)
    .all<{ url: string; kind: LinkKind }>();
  const urls = [...results].sort((a, b) => STAGE_DOC_KINDS.indexOf(a.kind) - STAGE_DOC_KINDS.indexOf(b.kind)).map((r) => r.url);
  if (e.website_url) urls.push(e.website_url);
  return [...new Set(urls)].slice(0, MAX_STAGE_DOCS);
}

async function askModel(llm: JsonModel, e: DueRace, doc: Doc): Promise<unknown[]> {
  const out = await llm.json({
    system: STAGES_PROMPT,
    content: [
      doc.content,
      { type: "text", text: `Závod: ${e.name} (${e.discipline})\nTermín: ${e.date_from}${e.date_to ? ` až ${e.date_to}` : ""}\nDokument: ${doc.url}` },
    ],
    schema: StagesSchema,
    accept: z.object({ stages: z.array(z.unknown()) }),
    maxTokens: 4000,
    effort: "low",
  });
  return out.data.stages;
}

/** Of the documents' stages, the best: with closure times first, then the most stages. */
function better(a: Stage[], b: Stage[]): boolean {
  const closures = (s: Stage[]) => s.filter((x) => x.closed_from).length;
  return closures(a) !== closures(b) ? closures(a) > closures(b) : a.length > b.length;
}

async function checkOne(deps: StageDeps, e: DueRace): Promise<StageReport> {
  const now = new Date().toISOString();
  try {
    const docs: Doc[] = [];
    for (const url of await candidateUrls(deps.db, e)) {
      try {
        const doc = await fetchDoc(deps.http, deps.llm, url);
        if (doc) docs.push(doc);
      } catch (err) {
        deps.log?.(`stages ${e.id}: ${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (docs.length === 0) {
      await deps.db
        .prepare(
          `INSERT INTO stage_checks (event_id, checked_at) VALUES (?, ?)
           ON CONFLICT (event_id) DO UPDATE SET checked_at = excluded.checked_at, error = NULL`,
        )
        .bind(e.id, now)
        .run();
      return { event_id: e.id, result: "no_documents" };
    }

    const parts = docs.flatMap((d) => [new TextEncoder().encode(`${d.url}\n`), d.bytes]);
    const all = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
    parts.reduce((off, p) => (all.set(p, off), off + p.byteLength), 0);
    const hash = await sha256Hex(all);
    if (hash === e.prev_hash) {
      await deps.db.prepare("UPDATE stage_checks SET checked_at = ?, error = NULL WHERE event_id = ?").bind(now, e.id).run();
      return { event_id: e.id, result: "unchanged" };
    }

    let best: { stages: Stage[]; url: string | null } = { stages: [], url: null };
    for (const doc of docs) {
      const { stages, skipped } = normalizeStages(e, await askModel(deps.llm, e, doc), doc.text);
      if (skipped.length) deps.log?.(`stages ${e.id}: ${doc.url}: skipped ${skipped.join("; ")}`);
      if (better(stages, best.stages)) best = { stages, url: doc.url };
    }

    const stmts = [
      deps.db.prepare("DELETE FROM event_stages WHERE event_id = ?").bind(e.id),
      ...best.stages.map((s, i) =>
        deps.db
          .prepare(
            `INSERT INTO event_stages (event_id, position, name, date, first_car, closed_from, closed_to, length_km)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(e.id, i, s.name, s.date, s.first_car, s.closed_from, s.closed_to, s.length_km),
      ),
      deps.db
        .prepare(
          `INSERT INTO stage_checks (event_id, checked_at, content_hash, doc_url, error) VALUES (?, ?, ?, ?, NULL)
           ON CONFLICT (event_id) DO UPDATE SET checked_at = excluded.checked_at, content_hash = excluded.content_hash,
             doc_url = excluded.doc_url, error = NULL`,
        )
        .bind(e.id, now, hash, best.url),
    ];
    for (const s of stmts) await s.run();
    return { event_id: e.id, result: "checked", stages: best.stages.length, doc_url: best.url };
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    // Keep earlier stages; only record the attempt so the race isn't retried until tomorrow.
    await deps.db
      .prepare(
        `INSERT INTO stage_checks (event_id, checked_at, error) VALUES (?, ?, ?)
         ON CONFLICT (event_id) DO UPDATE SET checked_at = excluded.checked_at, error = excluded.error`,
      )
      .bind(e.id, now, error)
      .run();
    deps.log?.(`stages ${e.id} failed: ${error}`);
    return { event_id: e.id, result: "error", error };
  }
}

/**
 * Read the stages of upcoming rallies and hill climbs from their documents
 * (daily, at most once a day per race; the model runs only when a document changed).
 */
export async function checkStages(deps: StageDeps, today: string, limit = DEFAULT_STAGE_LIMIT, windowDays = 14): Promise<StageReport[]> {
  const reports: StageReport[] = [];
  for (const e of await dueRaces(deps.db, today, limit, windowDays)) reports.push(await checkOne(deps, e));
  return reports;
}
