import { dedupeKey, mergeEvent, placeOf, preferredLocation, sameRaceName, samePlace, statedIn, type MergeFields } from "./dedupe.ts";
import type { EventLinkInput, NormalizedEvent, SourceRow } from "./schema.ts";
import type { GeoResult } from "./geocode.ts";

export interface UpsertStats {
  inserted: number;
  updated: number;
}

type EventRow = MergeFields & { id: string; lat: number | null; lng: number | null };

const EXISTING_COLUMNS = `e.id, e.dedupe_key, e.discipline, e.name, e.date_from, e.date_to, e.series, e.level, e.location_name, e.region, e.country,
  e.organizer, e.website_url, e.description, e.status, e.lat, e.lng,
  (SELECT MIN(s.priority) FROM event_sources es JOIN sources s ON s.id = es.source_id
    WHERE es.event_id = e.id AND es.source_id <> ?) AS best_other_priority`;

type ExistingRow = EventRow & { dedupe_key: string; discipline: string; date_from: string; best_other_priority: number | null };

/**
 * Cross-source match when the exact dedupe_key misses: same discipline ('jiny'
 * = unknown matches any), same
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
        WHERE (e.discipline = ? OR e.discipline = 'jiny' OR ? = 'jiny')
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
    .bind(source.id, e.discipline, e.discipline, place, place, place, e.date_to ?? e.date_from, e.date_from, source.provider, e.date_from)
    .first<ExistingRow>();
}

/**
 * The same race reported elsewhere under another place: same discipline, same
 * race name (sameRaceName), from another provider, dates within ±1 day
 * ('Rallye Jizera' in Liberec as guessed from the name vs Železný Brod as the
 * source says). A race under another date is merged by hand and remembered in
 * event_aliases.
 */
async function findNameMatch(
  db: D1Database,
  source: Pick<SourceRow, "id" | "provider">,
  e: NormalizedEvent,
): Promise<ExistingRow | null> {
  const { results } = await db
    .prepare(
      `SELECT ${EXISTING_COLUMNS}
         FROM events e
        WHERE (e.discipline = ? OR e.discipline = 'jiny' OR ? = 'jiny')
          AND e.date_from <= date(?, '+1 day')
          AND coalesce(e.date_to, e.date_from) >= date(?, '-1 day')
          AND NOT EXISTS (SELECT 1 FROM event_sources es JOIN sources s ON s.id = es.source_id
                           WHERE es.event_id = e.id AND s.provider = ?)
        ORDER BY abs(julianday(e.date_from) - julianday(?))`,
    )
    .bind(source.id, e.discipline, e.discipline, e.date_to ?? e.date_from, e.date_from, source.provider, e.date_from)
    .all<ExistingRow>();
  return results.find((x) => sameRaceName(x.name, e.name)) ?? null;
}

/**
 * Of two different places for one race, the one a source actually names
 * (statedIn its excerpt) beats a guess of the model; otherwise the winning
 * source's place.
 */
async function chooseLocation(
  db: D1Database,
  existing: ExistingRow,
  e: NormalizedEvent,
  incomingWins: boolean,
): Promise<string | null> {
  const preferred = preferredLocation(existing.location_name, e.location_name);
  if (preferred || !existing.location_name || !e.location_name) return preferred ?? existing.location_name ?? e.location_name;
  const { results } = await db
    .prepare("SELECT raw_excerpt FROM event_sources WHERE event_id = ?")
    .bind(existing.id)
    .all<{ raw_excerpt: string | null }>();
  const existingStated = results.some((r) => statedIn(existing.location_name!, r.raw_excerpt));
  const incomingStated = statedIn(e.location_name, e.raw_excerpt);
  if (existingStated !== incomingStated) return incomingStated ? e.location_name : existing.location_name;
  return incomingWins ? e.location_name : existing.location_name;
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
    // An alias: a key the event had before it was merged or moved (event_aliases).
    const exact = await db
      .prepare(
        `SELECT ${EXISTING_COLUMNS} FROM events e
          WHERE e.dedupe_key = ? OR e.id = (SELECT event_id FROM event_aliases WHERE dedupe_key = ?)`,
      )
      .bind(source.id, e.dedupe_key, e.dedupe_key)
      .first<ExistingRow>();
    (exact ? exactFirst : rest).push({ e, exact });
  }

  for (const { e, exact } of [...exactFirst, ...rest]) {
    const g = geo.get(e.dedupe_key) ?? null;
    const existing = exact ?? (await findNearMatch(db, source, e)) ?? (await findNameMatch(db, source, e));

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
      // A near match from a winning source moves the event to that source's dates.
      const moveDates = !exact && incomingWins;
      const dateFrom = moveDates ? e.date_from : existing.date_from;
      const dateTo = moveDates ? e.date_to : merged.date_to && merged.date_to > dateFrom ? merged.date_to : null;
      // 'Bečov' + 'Bečov nad Teplou' -> one event under the more specific name, whichever source wins;
      // two different places -> the one a source names (see chooseLocation).
      const location = await chooseLocation(db, existing, e, incomingWins);
      // Moved to the incoming source's place: its region and coordinates, not the old place's.
      const moved =
        location !== existing.location_name && location === e.location_name && !samePlace(placeOf(existing.dedupe_key), placeOf(e.dedupe_key));
      const region = moved ? (e.region ?? g?.region ?? null) : (merged.region ?? g?.region ?? null);
      const [lat, lng] = moved ? [g?.lat ?? null, g?.lng ?? null] : [existing.lat ?? g?.lat ?? null, existing.lng ?? g?.lng ?? null];
      // A source that knows the discipline replaces 'jiny' (unknown) from another one.
      const discipline = existing.discipline === "jiny" ? e.discipline : existing.discipline;
      let key = location ? dedupeKey(location, dateFrom, discipline) : moveDates ? e.dedupe_key : existing.dedupe_key;
      if (key !== existing.dedupe_key) {
        const taken = await db.prepare("SELECT 1 FROM events WHERE dedupe_key = ? AND id <> ?").bind(key, existing.id).first();
        if (taken) key = existing.dedupe_key;
        // The old key keeps pointing here, so the source that reported it finds the event again.
        else await rememberAlias(db, existing.dedupe_key, existing.id);
      }
      await db
        .prepare(
          `UPDATE events SET name = ?, discipline = ?, date_from = ?, date_to = ?, series = ?, level = ?, location_name = ?, region = ?,
                  lat = ?, lng = ?, country = ?, organizer = ?, website_url = ?, description = ?, status = ?,
                  dedupe_key = ?
            WHERE id = ?`,
        )
        .bind(
          merged.name, discipline, dateFrom, dateTo, merged.series, merged.level, location, region,
          lat, lng, merged.country, merged.organizer,
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
    await saveLinks(db, eventId, source.id, e.links);
  }
  return stats;
}

/**
 * Merge a duplicate into the event to keep: its sources, documents and keys
 * move over, empty fields of the kept event are filled from it, then the
 * duplicate row goes. The kept event's name, dates and place stay.
 */
export async function mergeEvents(db: D1Database, keepId: string, dropId: string): Promise<boolean> {
  if (keepId === dropId) return false;
  const drop = await db.prepare("SELECT dedupe_key FROM events WHERE id = ?").bind(dropId).first<{ dedupe_key: string }>();
  const keep = await db.prepare("SELECT 1 FROM events WHERE id = ?").bind(keepId).first();
  if (!drop || !keep) return false;
  await db
    .prepare(
      `UPDATE events SET
         series = COALESCE(events.series, d.series), region = COALESCE(events.region, d.region),
         organizer = COALESCE(events.organizer, d.organizer), website_url = COALESCE(events.website_url, d.website_url),
         description = COALESCE(events.description, d.description), lat = COALESCE(events.lat, d.lat), lng = COALESCE(events.lng, d.lng)
       FROM (SELECT * FROM events WHERE id = ?) AS d
       WHERE events.id = ?`,
    )
    .bind(dropId, keepId)
    .run();
  await db
    .prepare(
      `INSERT INTO event_sources (event_id, source_id, source_url, raw_excerpt, first_seen_at, last_seen_at)
       SELECT ?, source_id, source_url, raw_excerpt, first_seen_at, last_seen_at FROM event_sources WHERE event_id = ?
       ON CONFLICT (event_id, source_id) DO NOTHING`,
    )
    .bind(keepId, dropId)
    .run();
  await db
    .prepare(
      `INSERT INTO event_links (event_id, source_id, url, label, kind, position)
       SELECT ?, source_id, url, label, kind, position FROM event_links WHERE event_id = ?
       ON CONFLICT (event_id, url) DO NOTHING`,
    )
    .bind(keepId, dropId)
    .run();
  await db.prepare("UPDATE event_aliases SET event_id = ? WHERE event_id = ?").bind(keepId, dropId).run();
  await db.prepare("DELETE FROM events WHERE id = ?").bind(dropId).run();
  await rememberAlias(db, drop.dedupe_key, keepId);
  return true;
}

/** Remember a former key of an event (after a move or a merge of duplicates). */
export async function rememberAlias(db: D1Database, key: string, eventId: string): Promise<void> {
  await db
    .prepare("INSERT INTO event_aliases (dedupe_key, event_id) VALUES (?, ?) ON CONFLICT (dedupe_key) DO UPDATE SET event_id = excluded.event_id")
    .bind(key, eventId)
    .run();
}

/**
 * Replace a source's documents of an event with the current ones. A URL that
 * another source of the event already links keeps that source's row.
 */
export async function saveLinks(db: D1Database, eventId: string, sourceId: string, links: EventLinkInput[]): Promise<void> {
  await db.prepare("DELETE FROM event_links WHERE event_id = ? AND source_id = ?").bind(eventId, sourceId).run();
  let position = 0;
  for (const l of links) {
    await db
      .prepare(
        `INSERT INTO event_links (event_id, source_id, url, label, kind, position) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (event_id, url) DO NOTHING`,
      )
      .bind(eventId, sourceId, l.url, l.label, l.kind, position++)
      .run();
  }
}
