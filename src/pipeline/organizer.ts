import { z } from "zod";
import { decodeHtml } from "./decode.ts";
import { htmlToText } from "./htmlToText.ts";
import { sha256Hex, type PoliteClient } from "./http.ts";
import type { JsonModel } from "./llm.ts";
import { parseDate } from "./normalize.ts";

/** How far ahead organizer websites are checked, and how many per run. */
export const CHECK_WINDOW_DAYS = 14;
export const DEFAULT_CHECK_LIMIT = 10;
/** Daily check of races in the race-day window (today and tomorrow). */
export const LIVE_WINDOW_DAYS = 1;
const MAX_TEXT_CHARS = 60_000;

export const OrganizerCheckSchema = z.object({
  mentions_event: z.boolean().describe("Zmiňuje stránka právě tento závod (tento ročník / termín)?"),
  status: z.enum(["planned", "cancelled", "postponed", "unknown"]),
  date_from: z.string().nullable().describe("Termín začátku podle stránky, YYYY-MM-DD, jen když je výslovně uveden"),
  date_to: z.string().nullable().describe("Termín konce podle stránky, YYYY-MM-DD, jinak null"),
  notice: z
    .string()
    .nullable()
    .describe("Krátká věcná poznámka pro diváky (max. 1–2 věty, česky), jen když stránka hlásí zrušení, odklad, změnu termínu nebo místa; jinak null"),
  results_url: z.string().nullable().describe("Odkaz ze stránky na online výsledky nebo live timing tohoto závodu, přesně jak je na stránce; jinak null"),
  stream_url: z.string().nullable().describe("Odkaz ze stránky na živý přenos tohoto závodu (YouTube, Facebook live…), přesně jak je na stránce; jinak null"),
});
export type OrganizerCheck = z.infer<typeof OrganizerCheckSchema>;

export const ORGANIZER_PROMPT = `Kontroluješ web pořadatele automobilového závodu v ČR.
Dostaneš údaje o závodu z kalendáře a text webové stránky pořadatele. Zjisti, co stránka říká o TOMTO závodu.

Pravidla:
- mentions_event: true jen když stránka zmiňuje tento závod v této sezóně. Obecná stránka klubu bez termínu = false.
- status: cancelled / postponed jen když to stránka výslovně uvádí pro tento závod. Když stránka závod zmiňuje bez problémů, planned. Když nelze určit, unknown.
- date_from / date_to: jen termín výslovně uvedený na stránce pro tento závod, jinak null.
- notice: jen při zrušení, odkladu nebo změně termínu či místa, krátce a věcně. Žádná jména osob, žádné kontakty.
- results_url: odkaz (v textu ve tvaru „text (url)“) na online výsledky / live timing tohoto závodu, ne na přihlášky ani startovní listiny. stream_url: odkaz na živý přenos tohoto závodu, ne obecný kanál bez přenosu. Jen URL, které na stránce opravdu je.
- Nic si nedomýšlej.`;

export interface OrganizerDeps {
  db: D1Database;
  http: PoliteClient;
  llm: JsonModel;
  log?: (msg: string) => void;
}

interface DueEvent {
  id: string;
  name: string;
  date_from: string;
  date_to: string | null;
  location_name: string | null;
  website_url: string;
  prev_url: string | null;
  prev_hash: string | null;
}

interface PrevFindings {
  status: string | null;
  date_from: string | null;
  date_to: string | null;
  notice: string | null;
}

export type OrganizerReport =
  | { event_id: string; result: "unchanged" }
  | { event_id: string; result: "error"; error: string }
  | { event_id: string; result: "checked"; outcome: "confirmed" | "changed" | "not_mentioned" };

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Upcoming events with a website, soonest first, never-checked / longest-unchecked first within a day. */
export async function dueEvents(db: D1Database, today: string, limit: number, windowDays = CHECK_WINDOW_DAYS): Promise<DueEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.name, e.date_from, e.date_to, e.location_name, e.website_url,
              oc.url AS prev_url, oc.content_hash AS prev_hash
         FROM events e LEFT JOIN organizer_checks oc ON oc.event_id = e.id
        WHERE e.website_url IS NOT NULL
          AND e.status = 'planned'
          AND COALESCE(e.date_to, e.date_from) >= ?
          AND e.date_from <= ?
          AND (oc.checked_at IS NULL OR substr(oc.checked_at, 1, 10) < ?)
        ORDER BY e.date_from, oc.checked_at IS NOT NULL, oc.checked_at
        LIMIT ?`,
    )
    .bind(today, addDays(today, windowDays), today, limit)
    .all<DueEvent>();
  return results;
}

async function askModel(deps: OrganizerDeps, e: DueEvent, text: string): Promise<OrganizerCheck> {
  const out = await deps.llm.json({
    system: ORGANIZER_PROMPT,
    content: [
      { type: "text", text: `<page url="${e.website_url}">\n${text.slice(0, MAX_TEXT_CHARS)}\n</page>` },
      {
        type: "text",
        text: `Závod z kalendáře: ${e.name}\nTermín: ${e.date_from}${e.date_to ? ` až ${e.date_to}` : ""}\nMísto: ${e.location_name ?? "neuvedeno"}`,
      },
    ],
    schema: OrganizerCheckSchema,
    maxTokens: 2000,
    effort: "low",
  });
  return out.data;
}

/** A link the model reports: http(s) and really on the page (models make URLs up). */
export function pageLink(url: string | null | undefined, pageText: string): string | null {
  const u = url?.trim();
  if (!u || !/^https?:\/\/[^\s]+$/i.test(u) || u.length > 500) return null;
  return pageText.includes(u) ? u : null;
}

/** Turn the model's answer into what we store; dates must be real and near the event's season. */
export function interpret(e: Pick<DueEvent, "date_from" | "date_to">, c: OrganizerCheck, pageText = "") {
  const season = Number(e.date_from.slice(0, 4));
  if (!c.mentions_event) {
    return { outcome: "not_mentioned" as const, status: null, date_from: null, date_to: null, notice: null, results_url: null, stream_url: null };
  }
  let from = parseDate(c.date_from, season);
  let to = parseDate(c.date_to, season);
  if (from && Math.abs(Number(from.slice(0, 4)) - season) > 1) from = null;
  if (!from || (to && to <= from)) to = null;
  const status = c.status === "unknown" ? null : c.status;
  const datesDiffer = from != null && (from !== e.date_from || (to != null && to !== (e.date_to ?? e.date_from)));
  const changed = status === "cancelled" || status === "postponed" || datesDiffer;
  const notice = c.notice?.replace(/\s+/g, " ").trim().slice(0, 300) || null;
  return {
    outcome: changed ? ("changed" as const) : ("confirmed" as const),
    status,
    date_from: datesDiffer ? from : null,
    date_to: datesDiffer ? to : null,
    notice: changed ? notice : null,
    results_url: pageLink(c.results_url, pageText),
    stream_url: pageLink(c.stream_url, pageText),
  };
}

async function checkOne(deps: OrganizerDeps, e: DueEvent): Promise<OrganizerReport> {
  const now = new Date().toISOString();
  try {
    const res = await deps.http.get(e.website_url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("Content-Type") ?? "";
    if (type && !/html|text\/plain/i.test(type)) throw new Error(`unsupported content type ${type}`);
    const text = htmlToText(decodeHtml(new Uint8Array(await res.arrayBuffer()), type), e.website_url);
    const hash = await sha256Hex(new TextEncoder().encode(text));

    if (hash === e.prev_hash && e.website_url === e.prev_url) {
      await deps.db
        .prepare("UPDATE organizer_checks SET checked_at = ?, error = NULL WHERE event_id = ?")
        .bind(now, e.id)
        .run();
      return { event_id: e.id, result: "unchanged" };
    }

    const r = interpret(e, await askModel(deps, e, text), text);
    const prev = await deps.db
      .prepare("SELECT status, date_from, date_to, notice FROM organizer_checks WHERE event_id = ?")
      .bind(e.id)
      .first<PrevFindings>();
    const findingsChanged =
      !prev || prev.status !== r.status || prev.date_from !== r.date_from || prev.date_to !== r.date_to || prev.notice !== r.notice;

    await deps.db
      .prepare(
        `INSERT INTO organizer_checks (event_id, url, checked_at, content_hash, outcome, status, date_from, date_to, notice, error, changed_at, results_url, stream_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
         ON CONFLICT (event_id) DO UPDATE SET
           url = excluded.url, checked_at = excluded.checked_at, content_hash = excluded.content_hash,
           outcome = excluded.outcome, status = excluded.status, date_from = excluded.date_from,
           date_to = excluded.date_to, notice = excluded.notice, error = NULL,
           results_url = excluded.results_url, stream_url = excluded.stream_url,
           changed_at = CASE WHEN ? THEN excluded.changed_at ELSE organizer_checks.changed_at END`,
      )
      .bind(e.id, e.website_url, now, hash, r.outcome, r.status, r.date_from, r.date_to, r.notice, now, r.results_url, r.stream_url, findingsChanged ? 1 : 0)
      .run();
    return { event_id: e.id, result: "checked", outcome: r.outcome };
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    // Keep earlier findings; only record the attempt so the event isn't retried until tomorrow.
    await deps.db
      .prepare(
        `INSERT INTO organizer_checks (event_id, url, checked_at, outcome, error) VALUES (?, ?, ?, 'error', ?)
         ON CONFLICT (event_id) DO UPDATE SET checked_at = excluded.checked_at, error = excluded.error`,
      )
      .bind(e.id, e.website_url, now, error)
      .run();
    deps.log?.(`organizer check ${e.id} failed: ${error}`);
    return { event_id: e.id, result: "error", error };
  }
}

/**
 * Check organizer websites of upcoming events: weekly for the next two weeks
 * (after the calendar ingest), daily for today and tomorrow (LIVE_WINDOW_DAYS),
 * when results and stream links tend to appear. At most once a day per race.
 */
export async function checkOrganizers(
  deps: OrganizerDeps,
  today: string,
  limit = DEFAULT_CHECK_LIMIT,
  windowDays = CHECK_WINDOW_DAYS,
): Promise<OrganizerReport[]> {
  const reports: OrganizerReport[] = [];
  for (const e of await dueEvents(deps.db, today, limit, windowDays)) reports.push(await checkOne(deps, e));
  return reports;
}
