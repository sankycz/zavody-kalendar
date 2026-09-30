import { dedupeKey, mergeEvent, placeOf, preferredLocation, type MergeFields } from "./dedupe.ts";
import type { NormalizedEvent, SourceRow } from "./schema.ts";
import type { GeoResult } from "./geocode.ts";

export interface UpsertStats {
  inserted: number;
  updated: number;
}

type EventRow = MergeFields & { id: string; lat: number | null; lng: number | null };

const EXISTING_COLUMNS = `e.id, e.dedupe_key, e.name, e.date_from, e.date_to, e.series, e.level, e.location_name, e.region, e.country,
  e.organizer, e.website_url, e.description, e.status, e.lat, e.lng,
  (SELECT MIN(s.priority) FROM event_sources es JOIN sources s ON s.id = es.source_id
    WHERE es.event_id = e.id AND es.source_id <> ?) AS best_other_priority`;

type ExistingRow = EventRow & { dedupe_key: string; date_from: string; best_other_priority: number | null };

/**
 * Cross-source match when the exact dedupe_key misses: same discipline, same
 * normalized place, dates overlapping within ±1 day, and not already reported
 * by the same provider (one provider listing two races on consecutive days at
 * one place means two races). Catches off-by-one days and date typos between
 * sources (Autokaleidoskop vs Autoklub ČR), not arbitrary shifts.
 */
async function findNearMatch(
  db: D1Database,
  source: Pick<SourceRow, "id" | "provider">,
  e: NormalizedEvent,
): Promise<ExistingRow | null> {
  // Same place, or the same municipality written shorter/longer (see samePlace).
  const place = placeOf(e.dedupe_key);
  return db
    .prepare(
      `SELECT ${EXISTING_COLUMNS}
         FROM events e
        WHERE e.discipline = ?
          AND (substr(e.dedupe_key, 1, instr(e.dedupe_key, '|') - 1) = ?
               OR e.dedupe_key LIKE ? || '-%|%'
               OR ? LIKE substr(e.dedupe_key, 1, instr(e.dedupe_key, '|') - 1) || '-%')
          AND e.date_from <= date(?, '+1 day')
          AND coalesce(e.date_to, e.date_from) >= date(?, '-1 day')
          AND NOT EXISTS (SELECT 1 FROM event_sources es JOIN sources s ON s.id = es.source_id
                           WHERE es.event_id = e.id AND s.provider = ?)
        ORDER BY abs(julianday(e.date_from) - julianday(?))
        LIMIT 1`,
    )
    .bind(source.id, e.discipline, place, place, place, e.date_to ?? e.date_from, e.date_from, source.provider, e.date_from)
    .first<ExistingRow>();
}

/**
 * Upsert events from one source. An existing event (same dedupe_key, or a
 * near match from another provider) is merged by source priority: if this
 * source has equal or better (lower) priority than every source already linked
 * to the event, its values win — including the dates of a near match —
 * otherwise it only fills empty fields. Events are never deleted here.
 * Exact matches are applied first, so a near match can't grab an event that
 * another item of the same batch matches exactly.
 */
export async function upsertEvents(
  db: D1Database,
  source: Pick<SourceRow, "id" | "provider" | "url" | "priority">,
  events: NormalizedEvent[],
  geo: Map<string, GeoResult | null>,
): Promise<UpsertStats> {
  const stats: UpsertStats = { inserted: 0, updated: 0 };

  const exactFirst: { e: NormalizedEvent; exact: ExistingRow | null }[] = [];
  const rest: typeof exactFirst = [];
  for (const e of events) {
    const exact = await db
      .prepare(`SELECT ${EXISTING_COLUMNS} FROM events e WHERE e.dedupe_key = ?`)
      .bind(source.id, e.dedupe_key)
      .first<ExistingRow>();
    (exact ? exactFirst : rest).push({ e, exact });
  }

  for (const { e, exact } of [...exactFirst, ...rest]) {
    const g = geo.get(e.dedupe_key) ?? null;
    const existing = exact ?? (await findNearMatch(db, source, e));

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
      // A near match from a winning source moves the event to that source's dates.
      const moveDates = !exact && incomingWins;
      const dateFrom = moveDates ? e.date_from : existing.date_from;
      const dateTo = moveDates ? e.date_to : merged.date_to && merged.date_to > dateFrom ? merged.date_to : null;
      // 'Bečov' + 'Bečov nad Teplou' -> one event under the more specific name, whichever source wins.
      const location = preferredLocation(existing.location_name, e.location_name) ?? merged.location_name;
      let key = location ? dedupeKey(location, dateFrom, e.discipline) : moveDates ? e.dedupe_key : existing.dedupe_key;
      if (key !== existing.dedupe_key) {
        const taken = await db.prepare("SELECT 1 FROM events WHERE dedupe_key = ? AND id <> ?").bind(key, existing.id).first();
        if (taken) key = existing.dedupe_key;
      }
      await db
        .prepare(
          `UPDATE events SET name = ?, date_from = ?, date_to = ?, series = ?, level = ?, location_name = ?, region = ?,
                  lat = ?, lng = ?, country = ?, organizer = ?, website_url = ?, description = ?, status = ?,
                  dedupe_key = ?
            WHERE id = ?`,
        )
        .bind(
          merged.name, dateFrom, dateTo, merged.series, merged.level, location, region,
          existing.lat ?? g?.lat ?? null, existing.lng ?? g?.lng ?? null, merged.country, merged.organizer,
          merged.website_url, merged.description, merged.status, key,
          existing.id,
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
