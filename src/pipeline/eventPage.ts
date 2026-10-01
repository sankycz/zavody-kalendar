import { z } from "zod";
import { sameRaceName } from "./dedupe.ts";
import { normalizeLinks, normalizeUrl } from "./normalize.ts";
import type { EventLinkInput, SourceRow } from "./schema.ts";
import { saveLinks } from "./upsert.ts";

/**
 * Organizer pages of one race (sources.scope = 'event'). Such a page often
 * has the schedule, maps and regulations but not the date or the place (they
 * are on the poster). An item the normal path rejects for that reason is
 * attached by name to a race of the same season the calendars already know:
 * the source is linked to it, its documents are added and the page sets the
 * race's website and description (only fills them when a better source has them). No race is created from a page
 * without a date.
 */

export { nameWords, sameRaceName } from "./dedupe.ts";

const PageItem = z.object({
  name: z.string(),
  website_url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  raw_excerpt: z.string().nullable().optional(),
  links: z.unknown().optional(),
});

export type AttachResult = { ok: true; event_id: string; name: string; links: number } | { ok: false; error: string };

/**
 * Attach one item of an event page to the race of the season it names. Of
 * several matches the next upcoming one (or the latest past one) wins.
 */
export async function attachEventPage(
  db: D1Database,
  source: Pick<SourceRow, "id" | "url" | "season" | "priority">,
  raw: unknown,
  today: string,
): Promise<AttachResult> {
  const r = PageItem.safeParse(raw);
  if (!r.success || !r.data.name.trim()) return { ok: false, error: "event page item without a name" };
  const item = r.data;

  const { results } = await db
    .prepare(
      `SELECT id, name, date_from, date_to FROM events
        WHERE date_from BETWEEN ? AND ?
        ORDER BY CASE WHEN COALESCE(date_to, date_from) >= ? THEN 0 ELSE 1 END,
                 CASE WHEN COALESCE(date_to, date_from) >= ? THEN date_from END,
                 date_from DESC`,
    )
    .bind(`${source.season}-01-01`, `${source.season}-12-31`, today, today)
    .all<{ id: string; name: string; date_from: string; date_to: string | null }>();
  const match = results.find((e) => sameRaceName(e.name, item.name));
  if (!match) return { ok: false, error: `no race of ${source.season} named like '${item.name}'` };

  const excerpt = item.raw_excerpt?.replace(/\s+/g, " ").trim().slice(0, 500) || null;
  await db
    .prepare(
      `INSERT INTO event_sources (event_id, source_id, source_url, raw_excerpt) VALUES (?, ?, ?, ?)
       ON CONFLICT (event_id, source_id) DO UPDATE SET
         source_url = excluded.source_url,
         raw_excerpt = excluded.raw_excerpt,
         last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(match.id, source.id, source.url, excerpt)
    .run();

  // The organizer's page is the race's website when no better source gave one
  // (it beats a Facebook event link, not Autoklub ČR).
  const best = await db
    .prepare(
      `SELECT MIN(s.priority) AS p FROM event_sources es JOIN sources s ON s.id = es.source_id
        WHERE es.event_id = ? AND es.source_id <> ?`,
    )
    .bind(match.id, source.id)
    .first<{ p: number | null }>();
  const wins = best?.p == null || source.priority <= best.p;
  const website = normalizeUrl(item.website_url) ?? source.url;
  const description = item.description?.replace(/\s+/g, " ").trim().slice(0, 1000) || null;
  await db
    .prepare(
      wins
        ? "UPDATE events SET website_url = ?, description = COALESCE(?, description) WHERE id = ?"
        : "UPDATE events SET website_url = COALESCE(website_url, ?), description = COALESCE(description, ?) WHERE id = ?",
    )
    .bind(website, description, match.id)
    .run();

  const links: EventLinkInput[] = normalizeLinks(item.links);
  await saveLinks(db, match.id, source.id, links);
  return { ok: true, event_id: match.id, name: match.name, links: links.length };
}
