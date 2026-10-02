import { z } from "zod";
import { fold } from "./pipeline/normalize.ts";
import { eventToIcs } from "./shared/calendar.ts";
import { DISCIPLINES, LEVELS } from "./pipeline/schema.ts";
import type {
  EventDetail,
  EventLink,
  EventListItem,
  EventSourceLink,
  LiveLink,
  LiveLinks,
  EventsResponse,
  OrganizerCheckInfo,
  RegionsResponse,
} from "./shared/types.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const csvOf = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .transform((s) => s.split(",").filter(Boolean))
    .pipe(z.array(z.enum(values)));

export const EventsQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  discipline: csvOf(DISCIPLINES).optional(),
  level: csvOf(LEVELS).optional(),
  region: z.string().max(100).optional(),
  /** Full-text search: every word must occur in the name, place, region, series, organizer or discipline. */
  q: z.string().max(100).optional(),
});
export type EventsQuery = z.infer<typeof EventsQuery>;

/** Hour (0–23) in Czech time. */
export function pragueHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", hour: "2-digit", hourCycle: "h23" }).format(now));
}

/** Today's date in Czech time, 'YYYY-MM-DD'. */
export function todayInPrague(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(now);
}

/** Words a visitor may search a discipline by. */
const DISCIPLINE_WORDS: Record<string, string> = {
  rally: "rally rallye",
  rallysprint: "rallysprint rally sprint",
  vrch: "zavod do vrchu vrch",
  autocross: "autokros autocross rallycross",
  slalom: "autoslalom slalom",
  okruh: "okruh okruhy",
  drift: "drift",
  regularity: "regularity pravidelnost",
  historic: "historicka historic veterani",
  jiny: "",
};

/** Folded search words of a query ('Železné  hory' → ['zelezne', 'hory']). */
export function searchWords(q: string | undefined): string[] {
  return q ? fold(q).split(/[^a-z0-9]+/).filter(Boolean) : [];
}

type Searchable = Pick<EventListItem, "name" | "location_name" | "region" | "series" | "discipline"> & { organizer?: string | null };

export function matchesSearch(e: Searchable, words: string[]): boolean {
  if (words.length === 0) return true;
  const text = fold([e.name, e.location_name, e.region, e.series, e.organizer, DISCIPLINE_WORDS[e.discipline]].filter(Boolean).join(" "));
  return words.every((w) => text.includes(w));
}

export async function listEvents(db: D1Database, q: EventsQuery, today = todayInPrague()): Promise<EventsResponse> {
  // Races in the Czech Republic only (older rows may still hold races abroad).
  const where: string[] = ["e.country = 'CZ'", "COALESCE(e.date_to, e.date_from) >= ?"];
  const params: unknown[] = [q.from ?? today];
  if (q.to) {
    where.push("e.date_from <= ?");
    params.push(q.to);
  }
  if (q.discipline?.length) {
    where.push(`e.discipline IN (${q.discipline.map(() => "?").join(", ")})`);
    params.push(...q.discipline);
  }
  if (q.level?.length) {
    where.push(`e.level IN (${q.level.map(() => "?").join(", ")})`);
    params.push(...q.level);
  }
  if (q.region) {
    where.push("e.region = ?");
    params.push(q.region);
  }

  const [events, meta, seasons] = await Promise.all([
    db
      .prepare(
        `SELECT e.id, e.name, e.date_from, e.date_to, e.discipline, e.series, e.level, e.location_name,
                e.region, e.country, CASE WHEN oc.status = 'cancelled' AND e.status = 'planned' THEN 'cancelled' ELSE e.status END AS status, e.lat, e.lng,
                (SELECT COUNT(*) FROM event_sources es WHERE es.event_id = e.id) AS source_count, e.organizer,
                CASE WHEN oc.status = 'cancelled' THEN 'cancelled' WHEN oc.status = 'postponed' THEN 'postponed'
                     WHEN oc.date_from IS NOT NULL THEN 'date_changed' END AS organizer_flag
           FROM events e LEFT JOIN organizer_checks oc ON oc.event_id = e.id
          WHERE ${where.join(" AND ")}
          ORDER BY e.date_from, e.name
          LIMIT 2000`,
      )
      .bind(...params)
      .all<EventListItem & { organizer: string | null }>(),
    db.prepare("SELECT MAX(last_fetched_at) AS last FROM sources").first<{ last: string | null }>(),
    db
      .prepare("SELECT DISTINCT CAST(substr(date_from, 1, 4) AS INTEGER) AS year FROM events WHERE country = 'CZ' ORDER BY year")
      .all<{ year: number }>(),
  ]);

  // Diacritics-insensitive search in code: SQLite has no unaccent, and a season is a few hundred rows.
  const words = searchWords(q.q);
  const found = events.results.filter((e) => matchesSearch(e, words)).map(({ organizer: _o, ...e }) => e);
  return { events: found, last_ingest_at: meta?.last ?? null, seasons: seasons.results.map((r) => r.year) };
}

export async function getEvent(db: D1Database, id: string): Promise<EventDetail | null> {
  const event = await db
    .prepare(
      `SELECT e.id, e.name, e.date_from, e.date_to, e.discipline, e.series, e.level, e.location_name,
              e.region, e.country, CASE WHEN oc.status = 'cancelled' AND e.status = 'planned' THEN 'cancelled' ELSE e.status END AS status, e.lat, e.lng, e.organizer, e.website_url, e.description, e.updated_at,
              (SELECT COUNT(*) FROM event_sources es WHERE es.event_id = e.id) AS source_count,
              CASE WHEN oc.status = 'cancelled' THEN 'cancelled' WHEN oc.status = 'postponed' THEN 'postponed'
                     WHEN oc.date_from IS NOT NULL THEN 'date_changed' END AS organizer_flag
         FROM events e LEFT JOIN organizer_checks oc ON oc.event_id = e.id
        WHERE e.id = ?`,
    )
    .bind(id)
    .first<Omit<EventDetail, "sources" | "links" | "organizer_check">>();
  if (!event) return null;
  const check = await db
    .prepare(
      `SELECT url, checked_at, outcome, status, date_from, date_to, notice, error, changed_at, results_url, stream_url
         FROM organizer_checks WHERE event_id = ?`,
    )
    .bind(id)
    .first<OrganizerCheckInfo & { results_url: string | null; stream_url: string | null }>();
  const { results } = await db
    .prepare(
      `SELECT s.name, es.source_url AS url, es.last_seen_at
         FROM event_sources es JOIN sources s ON s.id = es.source_id
        WHERE es.event_id = ? ORDER BY s.priority, s.id`,
    )
    .bind(id)
    .all<EventSourceLink>();
  const links = await db
    .prepare(
      `SELECT l.label, l.url, l.kind
         FROM event_links l JOIN sources s ON s.id = l.source_id
        WHERE l.event_id = ? ORDER BY s.priority, l.position`,
    )
    .bind(id)
    .all<EventLink>();
  const live = await liveLinks(db, event, check, links.results);
  const organizer_check = check && (({ results_url: _r, stream_url: _s, ...c }) => c)(check);
  return { ...event, sources: results, links: links.results, organizer_check, live };
}

/** Hosts whose video links can be a live stream. */
const STREAM_HOST = /(^|\.)(youtube\.com|youtu\.be|facebook\.com|fb\.watch|twitch\.tv)$/;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Where to follow a race: results / live timing (the organizer's own link first,
 * then services for its discipline and series, from live_services) and live
 * streams (organizer's link, video links from sources on video sites).
 */
export async function liveLinks(
  db: D1Database,
  e: Pick<EventDetail, "name" | "date_from" | "discipline" | "series">,
  check: (Pick<OrganizerCheckInfo, "outcome"> & { results_url?: string | null; stream_url?: string | null }) | null,
  links: EventLink[],
): Promise<LiveLinks> {
  const { results: services } = await db
    .prepare(
      `SELECT label, url FROM live_services
        WHERE enabled = 1
          AND (disciplines IS NULL OR ',' || disciplines || ',' LIKE '%,' || ? || ',%')
          AND (name_like IS NULL OR COALESCE(?, '') LIKE name_like OR ? LIKE name_like)
        ORDER BY position, id`,
    )
    .bind(e.discipline, e.series, e.name)
    .all<{ label: string; url: string }>();
  const q = encodeURIComponent(`${e.name} ${e.date_from.slice(0, 4)}`);

  const results: LiveLink[] = [];
  const streams: LiveLink[] = [];
  const add = (list: LiveLink[], l: LiveLink) => {
    if (!list.some((x) => x.url === l.url)) list.push(l);
  };
  if (check?.results_url) add(results, { label: "Výsledky od pořadatele", url: check.results_url, from: "organizer" });
  for (const s of services) add(results, { label: s.label, url: s.url.replaceAll("{q}", q), from: "service" });
  if (check?.stream_url) add(streams, { label: "Přenos od pořadatele", url: check.stream_url, from: "organizer" });
  for (const l of links) {
    const host = hostOf(l.url);
    if (l.kind === "video" && host && STREAM_HOST.test(host)) add(streams, { label: l.label, url: l.url, from: "source" });
  }
  return { results, streams };
}

export async function listRegions(db: D1Database, today = todayInPrague()): Promise<RegionsResponse> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT region FROM events
        WHERE region IS NOT NULL AND country = 'CZ' AND COALESCE(date_to, date_from) >= ?
        ORDER BY region`,
    )
    .bind(today)
    .all<{ region: string }>();
  return { regions: results.map((r) => r.region) };
}

const CACHE = { "Cache-Control": "public, max-age=300" };

export async function handleApi(request: Request, db: D1Database): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  if (url.pathname === "/api/events") {
    const parsed = EventsQuery.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return Response.json({ error: "invalid query", issues: parsed.error.issues }, { status: 400 });
    }
    return Response.json(await listEvents(db, parsed.data), { headers: CACHE });
  }

  const detail = /^\/api\/events\/([0-9a-f]{32})$/.exec(url.pathname);
  if (detail) {
    const event = await getEvent(db, detail[1]!);
    return event
      ? Response.json(event, { headers: CACHE })
      : Response.json({ error: "not found" }, { status: 404 });
  }

  // Calendar entry (Apple Calendar, Outlook…): a link opens it, iPhone offers "Add to Calendar".
  const ics = /^\/api\/events\/([0-9a-f]{32})\/ics$/.exec(url.pathname);
  if (ics) {
    const event = await getEvent(db, ics[1]!);
    if (!event) return Response.json({ error: "not found" }, { status: 404 });
    return new Response(eventToIcs(event, `${url.origin}/zavod/${event.id}`), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="zavod-${event.date_from}.ics"`,
        ...CACHE,
      },
    });
  }

  if (url.pathname === "/api/regions") {
    return Response.json(await listRegions(db), { headers: CACHE });
  }

  return Response.json({ error: "not found" }, { status: 404 });
}
