import { mergeEvent, type MergeFields } from "./dedupe.ts";
import type { NormalizedEvent, SourceRow } from "./schema.ts";
import type { GeoResult } from "./geocode.ts";

export interface UpsertStats {
  inserted: number;
  updated: number;
}

type EventRow = MergeFields & { id: string; lat: number | null; lng: number | null };

/**
 * Upsert events from one source. An existing event (same dedupe_key) is merged
 * by source priority: if this source has equal or better (lower) priority than
 * every source already linked to the event, its values win; otherwise it only
 * fills empty fields. Events are never deleted here.
 */
export async function upsertEvents(
  db: D1Database,
  source: Pick<SourceRow, "id" | "url" | "priority">,
  events: NormalizedEvent[],
  geo: Map<string, GeoResult | null>,
): Promise<UpsertStats> {
  const stats: UpsertStats = { inserted: 0, updated: 0 };

  for (const e of events) {
    const g = geo.get(e.dedupe_key) ?? null;
    const existing = await db
      .prepare(
        `SELECT e.id, e.name, e.date_to, e.series, e.level, e.location_name, e.region, e.country,
                e.organizer, e.website_url, e.description, e.status, e.lat, e.lng,
                (SELECT MIN(s.priority) FROM event_sources es JOIN sources s ON s.id = es.source_id
                  WHERE es.event_id = e.id AND es.source_id <> ?) AS best_other_priority
           FROM events e WHERE e.dedupe_key = ?`,
      )
      .bind(source.id, e.dedupe_key)
      .first<EventRow & { best_other_priority: number | null }>();

    let eventId: string;
    if (!existing) {
      const row = await db
        .prepare(
          `INSERT INTO events (name, date_from, date_to, discipline, series, level, location_name, region,
                               lat, lng, country, organizer, website_url, description, status, dedupe_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(
          e.name, e.date_from, e.date_to, e.discipline, e.series, e.level, e.location_name,
          e.region ?? g?.region ?? null, g?.lat ?? null, g?.lng ?? null, e.country, e.organizer,
          e.website_url, e.description, e.status, e.dedupe_key,
        )
        .first<{ id: string }>();
      eventId = row!.id;
      stats.inserted++;
    } else {
      const incomingWins = existing.best_other_priority == null || source.priority <= existing.best_other_priority;
      const merged = mergeEvent(existing, e, incomingWins);
      const region = merged.region ?? g?.region ?? null;
      await db
        .prepare(
          `UPDATE events SET name = ?, date_to = ?, series = ?, level = ?, location_name = ?, region = ?,
                  lat = ?, lng = ?, country = ?, organizer = ?, website_url = ?, description = ?, status = ?
            WHERE id = ?`,
        )
        .bind(
          merged.name, merged.date_to, merged.series, merged.level, merged.location_name, region,
          existing.lat ?? g?.lat ?? null, existing.lng ?? g?.lng ?? null, merged.country, merged.organizer,
          merged.website_url, merged.description, merged.status, existing.id,
        )
        .run();
      eventId = existing.id;
      stats.updated++;
    }

    await db
      .prepare(
        `INSERT INTO event_sources (event_id, source_id, source_url, raw_excerpt) VALUES (?, ?, ?, ?)
         ON CONFLICT (event_id, source_id) DO UPDATE SET
           source_url = excluded.source_url,
           raw_excerpt = excluded.raw_excerpt,
           last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .bind(eventId, source.id, source.url, e.raw_excerpt)
      .run();
  }
  return stats;
}
