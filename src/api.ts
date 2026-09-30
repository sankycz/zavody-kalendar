import { z } from "zod";
import { DISCIPLINES, LEVELS } from "./pipeline/schema.ts";
import type { EventListItem, EventsResponse } from "./shared/types.ts";

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
});
export type EventsQuery = z.infer<typeof EventsQuery>;

/** Today's date in Czech time, 'YYYY-MM-DD'. */
export function todayInPrague(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(now);
}

export async function listEvents(db: D1Database, q: EventsQuery, today = todayInPrague()): Promise<EventsResponse> {
  const where: string[] = ["COALESCE(e.date_to, e.date_from) >= ?"];
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

  const [events, meta] = await Promise.all([
    db
      .prepare(
        `SELECT e.id, e.name, e.date_from, e.date_to, e.discipline, e.series, e.level, e.location_name,
                e.region, e.country, e.status, e.lat, e.lng,
                (SELECT COUNT(*) FROM event_sources es WHERE es.event_id = e.id) AS source_count
           FROM events e
          WHERE ${where.join(" AND ")}
          ORDER BY e.date_from, e.name
          LIMIT 2000`,
      )
      .bind(...params)
      .all<EventListItem>(),
    db.prepare("SELECT MAX(last_fetched_at) AS last FROM sources").first<{ last: string | null }>(),
  ]);

  return { events: events.results, last_ingest_at: meta?.last ?? null };
}

export async function handleApi(request: Request, db: D1Database): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  if (url.pathname === "/api/events") {
    const parsed = EventsQuery.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return Response.json({ error: "invalid query", issues: parsed.error.issues }, { status: 400 });
    }
    return Response.json(await listEvents(db, parsed.data), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }

  return Response.json({ error: "not found" }, { status: 404 });
}
