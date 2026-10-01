import { decodeHtml } from "./decode.ts";
import type { PoliteClient } from "./http.ts";
import { fold } from "./normalize.ts";
import type { SourceRow } from "./schema.ts";

/**
 * Next season without code changes: for every source of the current season
 * that has no row for next year yet, find next year's calendar and add it to
 * `sources`. Generic rules, no per-site code:
 *  1. URL without the year (the organizer reuses the page) → same URL.
 *  2. URL with the year → the same URL with the year + 1, if it exists.
 *  3. Otherwise the link on `index_url` (a PDF: on next year's page of the
 *     same provider) that contains next year and is most like the current URL.
 * Not found yet → tried again on the next run. Past seasons are switched off.
 */

export type RolloverResult =
  | { source: string; season: number; status: "added"; id: string; url: string; how: "same-url" | "year-in-url" | "index" }
  | { source: string; season: number; status: "not-found"; reason: string };

/** Words of a URL's path and query, without numbers ("Kalendar-automobilovych-zavodu-v-CR-2026" → kalendar, automobilovych…). */
export function urlWords(url: string): Set<string> {
  let path: string;
  try {
    const u = new URL(url);
    path = decodeURIComponent(u.pathname + u.search);
  } catch {
    path = url;
  }
  return new Set(
    fold(path)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 0 && !/^\d+$/.test(w)),
  );
}

/** Share of the current URL's words that the candidate has too. */
export function similarity(current: string, candidate: string): number {
  const a = urlWords(current);
  if (a.size === 0) return 0;
  const b = urlWords(candidate);
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / a.size;
}

/** Absolute http(s) links of a page. */
export function pageLinks(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1]!.replace(/&amp;/g, "&"), base);
      if (u.protocol === "http:" || u.protocol === "https:") out.push(u.toString());
    } catch {
      /* not a URL */
    }
  }
  return [...new Set(out)];
}

const MIN_SIMILARITY = 0.75;

/**
 * Best link to next season's calendar: same kind (PDF or page), the most
 * similar to the current URL. `requireYear`: the link itself must name next
 * year (on an index page that lists several seasons), not the current one.
 */
export function pickLink(links: string[], current: string, kind: "html" | "pdf", year: number, requireYear: boolean): string | null {
  let best: { url: string; score: number } | null = null;
  for (const url of links) {
    const isPdf = new URL(url).pathname.toLowerCase().endsWith(".pdf");
    if (isPdf !== (kind === "pdf") || url === current) continue;
    if (requireYear && (!url.includes(String(year)) || url.includes(String(year - 1)))) continue;
    const score = similarity(current, url);
    if (score >= MIN_SIMILARITY && (!best || score > best.score)) best = { url, score };
  }
  return best?.url ?? null;
}

/** Id / name of the new row: the year swapped, or appended. */
function nextLabel(s: string, year: number, sep: string): string {
  return s.includes(String(year - 1)) ? s.replaceAll(String(year - 1), String(year)) : `${s}${sep}${year}`;
}

async function fetchText(http: PoliteClient, url: string): Promise<{ text: string; finalUrl: string } | null> {
  try {
    const res = await http.get(url);
    if (!res.ok) return null;
    return { text: decodeHtml(new Uint8Array(await res.arrayBuffer()), res.headers.get("Content-Type")), finalUrl: res.url || url };
  } catch {
    return null;
  }
}

async function findNext(http: PoliteClient, s: SourceRow, year: number, nextOfProvider: Map<string, string>) {
  const cur = String(year - 1);
  if (s.via === "facebook" || !s.url.includes(cur)) return { url: s.url, how: "same-url" as const };

  // The same address with the year changed – must exist and really be about next year
  // (sites often answer 200 with a "not found" page).
  const swapped = s.url.replaceAll(cur, String(year));
  const page = await fetchText(http, swapped);
  if (page && page.finalUrl.includes(String(year)) && page.text.includes(String(year))) {
    return { url: swapped, how: "year-in-url" as const };
  }

  // A PDF is linked from next year's page of the same provider; otherwise the index page.
  const nextPage = s.kind === "pdf" ? nextOfProvider.get(s.provider) : undefined;
  const index = nextPage ?? s.index_url;
  if (!index) return { reason: "no index_url and the URL with the year changed doesn't exist" };
  const indexPage = await fetchText(http, index);
  if (!indexPage) return { reason: `index ${index} unavailable` };
  const link = pickLink(pageLinks(indexPage.text, indexPage.finalUrl), s.url, s.kind, year, !nextPage);
  return link ? { url: link, how: "index" as const } : { reason: `no link to ${year} on ${index}` };
}

export async function rollover(db: D1Database, http: PoliteClient, today: string): Promise<RolloverResult[]> {
  const year = Number(today.slice(0, 4)) + 1;
  await db.prepare("UPDATE sources SET enabled = 0 WHERE season < ? AND enabled = 1").bind(year - 1).run();

  const { results } = await db.prepare("SELECT * FROM sources WHERE season = ?").bind(year - 1).all<SourceRow>();
  const { results: existing } = await db
    .prepare("SELECT provider, kind, url FROM sources WHERE season = ?")
    .bind(year)
    .all<{ provider: string; kind: string; url: string }>();
  const have = new Set(existing.map((r) => `${r.provider}|${r.kind}`));
  const nextOfProvider = new Map(existing.filter((r) => r.kind === "html").map((r) => [r.provider, r.url]));

  const out: RolloverResult[] = [];
  // Pages first, so a PDF can be looked up on next year's page found in this run.
  for (const s of [...results].sort((a, b) => (a.kind === "pdf" ? 1 : 0) - (b.kind === "pdf" ? 1 : 0))) {
    if (have.has(`${s.provider}|${s.kind}`)) continue;
    const found = await findNext(http, s, year, nextOfProvider);
    if ("reason" in found) {
      out.push({ source: s.id, season: year, status: "not-found", reason: found.reason });
      continue;
    }
    const id = nextLabel(s.id, year, "-");
    await db
      .prepare(
        `INSERT INTO sources (id, provider, name, url, season, kind, via, priority, enabled, index_url, max_pages)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, s.provider, nextLabel(s.name, year, " "), found.url, year, s.kind, s.via ?? "web", s.priority, s.enabled, s.index_url ?? null, s.max_pages ?? 1)
      .run();
    if (s.kind === "html") nextOfProvider.set(s.provider, found.url);
    out.push({ source: s.id, season: year, status: "added", id, url: found.url, how: found.how });
  }
  return out;
}
