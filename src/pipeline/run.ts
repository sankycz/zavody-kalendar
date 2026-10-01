import { dedupeBatch } from "./dedupe.ts";
import { extractEvents } from "./extract.ts";
import { excerptWithoutDescription, facebookInput, facebookPoint, parseTargets, type ApifyEvents } from "./facebook.ts";
import { geocode, type GeoResult } from "./geocode.ts";
import { decodeHtml } from "./decode.ts";
import { htmlToText } from "./htmlToText.ts";
import type { JsonModel } from "./llm.ts";
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
  /** For the geocoder (Open-Meteo): >= 1 s between requests. */
  geoHttp: PoliteClient;
  /** Claude API or Workers AI, see llm.ts. */
  llm: JsonModel;
  /** Facebook events via Apify; unset when APIFY_TOKEN isn't configured. */
  apify?: ApifyEvents;
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
      /** Races left out because they take place outside the Czech Republic. */
      abroad?: string[];
      /** First few geocoding failures (distinct messages). */
      geocode_errors?: string[];
      /** Blocks the model failed on; the source is retried on the next run. */
      failed_blocks?: string[];
      stats: UpsertStats;
      usage: { input_tokens: number; output_tokens: number };
    };

export async function runSource(deps: RunDeps, source: SourceRow, opts: { force?: boolean } = {}): Promise<RunReport> {
  const log = deps.log ?? (() => {});
  try {
    let text: string | null = null;
    let bytes = new Uint8Array();
    let points: Map<string, GeoResult> | null = null;
    if (source.via === "facebook") {
      if (!deps.apify) throw new Error("APIFY_TOKEN is not set");
      const fb = facebookInput(await deps.apify.events(parseTargets(source.url)), source.season);
      text = fb.text;
      points = fb.points;
    } else {
      const res = await deps.http.get(source.url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${source.url}`);
      bytes = new Uint8Array(await res.arrayBuffer());
      // HTML is hashed after text extraction, so a scheduled run doesn't re-extract
      // (and pay for) a page whose only change is an ad, counter or nonce.
      if (source.kind === "html") text = htmlToText(decodeHtml(bytes, res.headers.get("Content-Type")), source.url);
    }
    const hash = await sha256Hex(text != null ? new TextEncoder().encode(text) : bytes);

    if (!opts.force && hash === source.last_content_hash) {
      await deps.db
        .prepare("UPDATE sources SET last_fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
        .bind(source.id)
        .run();
      log(`${source.id}: unchanged`);
      return { source: source.id, status: "unchanged", hash };
    }

    // Facebook with no upcoming event in CZ: nothing for the model to read.
    const extracted =
      points?.size === 0
        ? { items: [], usage: { input_tokens: 0, output_tokens: 0 } }
        : await extractEvents(deps.llm, {
            sourceName: source.name,
            season: source.season,
            kind: source.kind,
            ...(text != null ? { text } : { pdf: bytes }),
          });

    const batch = processExtraction(extracted.items, source.season);
    for (const bad of batch.invalid) log(`${source.id}: skipped invalid item: ${bad.error}`, bad.raw);

    // The calendar covers races in the Czech Republic only.
    const abroad: string[] = batch.events.filter((e) => e.country !== "CZ").map((e) => `${e.name} (${e.country})`);
    const events: NormalizedEvent[] = [];
    const geo = new Map<string, GeoResult | null>();
    let geocoded = 0;
    const geocodeErrors = new Set<string>();
    for (const e of batch.events) {
      if (e.country !== "CZ") continue;
      // Facebook knows where its event is: take its point, geocode only for the region.
      const point = points ? facebookPoint(points, e.website_url, e.name) : undefined;
      if (points) e.raw_excerpt = excerptWithoutDescription(e.raw_excerpt);
      try {
        const found = await geocode(deps.db, deps.geoHttp, e.location_name!, e.country).catch((err: unknown) => {
          if (point) return null;
          throw err;
        });
        const g = point ? { ...point, region: found?.country === "CZ" ? found.region : null } : found;
        if (g && g.country !== "CZ") {
          abroad.push(`${e.name} (${e.location_name}, ${g.country})`);
          continue;
        }
        geo.set(e.dedupe_key, g);
        if (g) geocoded++;
      } catch (err) {
        log(`${source.id}: geocoding failed for '${e.location_name}': ${String(err)}`);
        if (geocodeErrors.size < 3) geocodeErrors.add(String(err));
      }
      events.push(e);
    }

    const stats = await upsertEvents(deps.db, source, events, geo);

    // Store the hash only after a complete, successful upsert, so a failed run is retried next time.
    await deps.db
      .prepare(
        "UPDATE sources SET last_content_hash = ?, last_fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      )
      .bind(extracted.failedBlocks ? null : hash, source.id)
      .run();

    log(`${source.id}: ${events.length} events (${stats.inserted} new, ${stats.updated} updated), ${batch.invalid.length} invalid`);
    return {
      source: source.id,
      status: "ok",
      hash,
      extracted: extracted.items.length,
      valid: events.length,
      ...(abroad.length ? { abroad } : {}),
      invalid: batch.invalid,
      geocoded,
      ...(geocodeErrors.size ? { geocode_errors: [...geocodeErrors] } : {}),
      ...(extracted.failedBlocks ? { failed_blocks: extracted.failedBlocks } : {}),
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
 * Mark events that are over as finished (each run). Cancelled ones stay cancelled.
 * `today` is the Czech date 'YYYY-MM-DD'.
 */
export async function markFinished(db: D1Database, today: string): Promise<number> {
  const r = await db
    .prepare("UPDATE events SET status = 'finished' WHERE status = 'planned' AND COALESCE(date_to, date_from) < ?")
    .bind(today)
    .run();
  return r.meta.changes ?? 0;
}
