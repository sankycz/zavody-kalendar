import { dedupeBatch } from "./dedupe.ts";
import { extractEvents, type MessagesClient } from "./extract.ts";
import { geocode, type GeoResult } from "./geocode.ts";
import { decodeHtml } from "./decode.ts";
import { htmlToText } from "./htmlToText.ts";
import { sha256Hex, type PoliteClient } from "./http.ts";
import { normalizeEvent } from "./normalize.ts";
import type { NormalizedEvent, SourceRow } from "./schema.ts";
import { upsertEvents, type UpsertStats } from "./upsert.ts";

export interface InvalidItem {
  error: string;
  raw: unknown;
}

export interface ProcessedBatch {
  events: NormalizedEvent[];
  invalid: InvalidItem[];
}

/** Normalize + validate + in-batch dedupe. Pure, no I/O — covered by fixture tests. */
export function processExtraction(items: unknown[], season: number): ProcessedBatch {
  const valid: NormalizedEvent[] = [];
  const invalid: InvalidItem[] = [];
  for (const raw of items) {
    const r = normalizeEvent(raw, season);
    if (r.ok) valid.push(r.event);
    else invalid.push({ error: r.error, raw: r.raw });
  }
  return { events: dedupeBatch(valid), invalid };
}

export interface RunDeps {
  db: D1Database;
  /** For source websites: robots.txt + a few seconds between requests per host. */
  http: PoliteClient;
  /** For Nominatim: >= 1 s between requests. */
  geoHttp: PoliteClient;
  claude: MessagesClient;
  model: string;
  log?: (msg: string, data?: unknown) => void;
}

export type RunReport =
  | { source: string; status: "unchanged"; hash: string }
  | { source: string; status: "error"; error: string }
  | {
      source: string;
      status: "ok";
      hash: string;
      extracted: number;
      valid: number;
      invalid: InvalidItem[];
      geocoded: number;
      stats: UpsertStats;
      usage: { input_tokens: number; output_tokens: number };
    };

export async function runSource(deps: RunDeps, source: SourceRow, opts: { force?: boolean } = {}): Promise<RunReport> {
  const log = deps.log ?? (() => {});
  try {
    const res = await deps.http.get(source.url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${source.url}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // HTML is hashed after text extraction, so a daily run doesn't re-extract
    // (and pay for) a page whose only change is an ad, counter or nonce.
    const text =
      source.kind === "html" ? htmlToText(decodeHtml(bytes, res.headers.get("Content-Type")), source.url) : null;
    const hash = await sha256Hex(text != null ? new TextEncoder().encode(text) : bytes);

    if (!opts.force && hash === source.last_content_hash) {
      await deps.db
        .prepare("UPDATE sources SET last_fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
        .bind(source.id)
        .run();
      log(`${source.id}: unchanged`);
      return { source: source.id, status: "unchanged", hash };
    }

    const extracted = await extractEvents(deps.claude, deps.model, {
      sourceName: source.name,
      season: source.season,
      kind: source.kind,
      ...(text != null ? { text } : { pdf: bytes }),
    });

    const batch = processExtraction(extracted.items, source.season);
    for (const bad of batch.invalid) log(`${source.id}: skipped invalid item: ${bad.error}`, bad.raw);

    const geo = new Map<string, GeoResult | null>();
    let geocoded = 0;
    for (const e of batch.events) {
      if (!e.location_name) continue;
      try {
        const g = await geocode(deps.db, deps.geoHttp, e.location_name, e.country);
        geo.set(e.dedupe_key, g);
        if (g) geocoded++;
      } catch (err) {
        log(`${source.id}: geocoding failed for '${e.location_name}': ${String(err)}`);
      }
    }

    const stats = await upsertEvents(deps.db, source, batch.events, geo);

    // Store the hash only after a successful upsert, so a failed run is retried next time.
    await deps.db
      .prepare(
        "UPDATE sources SET last_content_hash = ?, last_fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      )
      .bind(hash, source.id)
      .run();

    log(`${source.id}: ${batch.events.length} events (${stats.inserted} new, ${stats.updated} updated), ${batch.invalid.length} invalid`);
    return {
      source: source.id,
      status: "ok",
      hash,
      extracted: extracted.items.length,
      valid: batch.events.length,
      invalid: batch.invalid,
      geocoded,
      stats,
      usage: extracted.usage,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log(`${source.id}: failed: ${error}`);
    return { source: source.id, status: "error", error };
  }
}

/** Run every enabled source, best priority first (Autoklub ČR before the rest). */
export async function runAll(deps: RunDeps, opts: { sourceId?: string; force?: boolean } = {}): Promise<RunReport[]> {
  const stmt = opts.sourceId
    ? deps.db.prepare("SELECT * FROM sources WHERE id = ?").bind(opts.sourceId)
    : deps.db.prepare("SELECT * FROM sources WHERE enabled = 1 ORDER BY priority, id");
  const { results } = await stmt.all<SourceRow>();
  const reports: RunReport[] = [];
  for (const s of results) reports.push(await runSource(deps, s, opts));
  return reports;
}

/**
 * Mark events that are over as finished (daily). Cancelled ones stay cancelled.
 * `today` is the Czech date 'YYYY-MM-DD'.
 */
export async function markFinished(db: D1Database, today: string): Promise<number> {
  const r = await db
    .prepare("UPDATE events SET status = 'finished' WHERE status = 'planned' AND COALESCE(date_to, date_from) < ?")
    .bind(today)
    .run();
  return r.meta.changes ?? 0;
}
