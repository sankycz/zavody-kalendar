import { z } from "zod";
import { fold, normalizeLinks, normalizeUrl } from "./normalize.ts";
import type { EventLinkInput, SourceRow } from "./schema.ts";
import { saveLinks } from "./upsert.ts";

/**
 * Organizer pages of one race (sources.scope = 'event'). Such a page often
 * has the schedule, maps and regulations but not the date or the place (they
 * are on the poster). An item the normal path rejects for that reason is
 * attached by name to a race of the same season the calendars already know:
 * the source is linked to it, its documents are added and the page fills the
 * race's empty website and description. No race is created from a page
 * without a date.
 */

/** Words that say nothing about which race it is. */
const STOP = new Set(["a", "v", "ve", "na", "u", "do", "z", "ze", "of", "the", "cz", "rocnik", "zavod", "zavody"]);

/** Distinctive words of a race name: no diacritics, years, ordinals (XI., 11.) or stop words. */
export function nameWords(name: string): Set<string> {
  return new Set(
    fold(name)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !/^[ivxlc]+$/.test(w) && !STOP.has(w)),
  );
}

/**
 * Same race named in two places: most words of the shorter name appear in the
 * other one ('Podbrdské setkání Legend' ~ 'XI. Podbrdské setkání legend 2026'),
 * and at least two of them, so 'Rally Vsetín' doesn't match 'Rally Jizera'
 * and a one-word name matches nothing.
 */
export function sameRaceName(a: string, b: string): boolean {
  const wa = nameWords(a);
  const wb = nameWords(b);
  const shorter = wa.size <= wb.size ? wa : wb;
  const longer = shorter === wa ? wb : wa;
  let shared = 0;
  for (const w of shorter) if (longer.has(w)) shared++;
  return shared >= 2 && shared / shorter.size >= 0.75;
}

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
  source: Pick<SourceRow, "id" | "url" | "season">,
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

  // The organizer's page is the race's website when no source gave one.
  const website = normalizeUrl(item.website_url) ?? source.url;
  const description = item.description?.replace(/\s+/g, " ").trim().slice(0, 1000) || null;
  await db
    .prepare(
      `UPDATE events SET website_url = COALESCE(website_url, ?), description = COALESCE(description, ?)
        WHERE id = ? AND (website_url IS NULL OR (description IS NULL AND ? IS NOT NULL))`,
    )
    .bind(website, description, match.id, description)
    .run();

  const links: EventLinkInput[] = normalizeLinks(item.links);
  await saveLinks(db, match.id, source.id, links);
  return { ok: true, event_id: match.id, name: match.name, links: links.length };
}
