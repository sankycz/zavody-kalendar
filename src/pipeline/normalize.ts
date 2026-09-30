import { z } from "zod";
import { DISCIPLINES, LEVELS, STATUSES, type NormalizedEvent } from "./schema.ts";
import { dedupeKey } from "./dedupe.ts";

export type NormalizeResult =
  | { ok: true; event: NormalizedEvent }
  | { ok: false; error: string; raw: unknown };

const MAX_TEXT = 1000;
const MAX_EXCERPT = 500;

const DISCIPLINE_ALIASES: Record<string, (typeof DISCIPLINES)[number]> = {
  rallye: "rally",
  rally: "rally",
  "rally sprint": "rallysprint",
  rallysprint: "rallysprint",
  "rallye sprint": "rallysprint",
  vrch: "vrch",
  "zavod do vrchu": "vrch",
  "do vrchu": "vrch",
  hillclimb: "vrch",
  autokros: "autocross",
  autocross: "autocross",
  rallycross: "autocross",
  autoslalom: "slalom",
  slalom: "slalom",
  okruh: "okruh",
  okruhy: "okruh",
  drift: "drift",
  regularity: "regularity",
  historic: "historic",
  historicke: "historic",
  jiny: "jiny",
};

const LEVEL_ALIASES: Record<string, (typeof LEVELS)[number]> = {
  mcr: "mcr",
  "mistrovstvi cr": "mcr",
  pohar: "pohar",
  cup: "pohar",
  serie: "pohar",
  rss: "pohar",
  regionalni: "regionalni",
  prebor: "regionalni",
  oblastni: "regionalni",
  volny: "volny",
  "volny zavod": "volny",
};

/** Lowercase, strip diacritics and collapse whitespace. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(v: string | null | undefined, max = MAX_TEXT): string | null {
  if (v == null) return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || t === "-" || fold(t) === "null") return null;
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Parse the date formats seen in Czech calendars into ISO 'YYYY-MM-DD'.
 * Accepts '2026-05-09', '9.5.2026', '9. 5. 2026', '09.05.26', '9.5.' (season year).
 * Returns null for anything that isn't a real calendar date.
 */
export function parseDate(input: string | null | undefined, season: number): string | null {
  if (!input) return null;
  const s = input.trim().replace(/\s+/g, "");

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isRealDate(y, mo, d) ? iso(y, mo, d) : null;
  }

  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?$/.exec(s);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : season;
    if (y < 100) y += 2000;
    return isRealDate(y, mo, d) ? iso(y, mo, d) : null;
  }

  return null;
}

function mapEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  aliases: Record<string, T>,
): T | null {
  const f = fold(value);
  if ((allowed as readonly string[]).includes(f)) return f as T;
  return aliases[f] ?? null;
}

/** Name of the municipality: drop "okolí", trailing track descriptors, parentheses. */
export function normalizeLocation(v: string | null | undefined): string | null {
  const t = cleanText(v, 120);
  if (!t) return null;
  const out = t
    .replace(/^(okolí|okoli|u|trať|trat)\s+/i, "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s+-\s+.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return out || null;
}

export function normalizeUrl(v: string | null | undefined): string | null {
  const t = cleanText(v, 500);
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : /^www\./i.test(t) ? `https://${t}` : null;
  if (!withScheme) return null;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

const LooseItem = z.object({
  name: z.string(),
  date_from: z.string(),
  date_to: z.string().nullable().optional(),
  discipline: z.string(),
  series: z.string().nullable().optional(),
  level: z.string(),
  location_name: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  organizer: z.string().nullable().optional(),
  website_url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  raw_excerpt: z.string().nullable().optional(),
});

/**
 * Validate and normalize one extracted item. Never throws: invalid items come
 * back as { ok: false } so the caller can log and skip them.
 */
export function normalizeEvent(raw: unknown, season: number): NormalizeResult {
  const parsed = LooseItem.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `shape: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`, raw };
  }
  const r = parsed.data;

  const name = cleanText(r.name, 200);
  if (!name) return { ok: false, error: "missing name", raw };

  const date_from = parseDate(r.date_from, season);
  if (!date_from) return { ok: false, error: `invalid date_from '${r.date_from}'`, raw };

  const year = Number(date_from.slice(0, 4));
  if (Math.abs(year - season) > 1) {
    return { ok: false, error: `date_from ${date_from} outside season ${season}`, raw };
  }

  let date_to = r.date_to ? parseDate(r.date_to, season) : null;
  if (r.date_to && !date_to) return { ok: false, error: `invalid date_to '${r.date_to}'`, raw };
  if (date_to === date_from) date_to = null;
  if (date_to && date_to < date_from) return { ok: false, error: `date_to ${date_to} before date_from ${date_from}`, raw };

  const discipline = mapEnum(r.discipline, DISCIPLINES, DISCIPLINE_ALIASES);
  if (!discipline) return { ok: false, error: `unknown discipline '${r.discipline}'`, raw };

  const level = mapEnum(r.level, LEVELS, LEVEL_ALIASES);
  if (!level) return { ok: false, error: `unknown level '${r.level}'`, raw };

  const status = r.status ? mapEnum(r.status, STATUSES, {}) ?? "planned" : "planned";

  const countryRaw = (r.country ?? "CZ").trim().toUpperCase();
  const country = /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : "CZ";

  const location_name = normalizeLocation(r.location_name);
  if (!location_name) return { ok: false, error: "missing location_name", raw };

  return {
    ok: true,
    event: {
      name,
      date_from,
      date_to,
      discipline,
      series: cleanText(r.series, 200),
      level,
      location_name,
      region: cleanText(r.region, 100),
      country,
      organizer: cleanText(r.organizer, 200),
      website_url: normalizeUrl(r.website_url),
      description: cleanText(r.description),
      status,
      raw_excerpt: cleanText(r.raw_excerpt, MAX_EXCERPT),
      dedupe_key: dedupeKey(location_name, date_from, discipline),
    },
  };
}
