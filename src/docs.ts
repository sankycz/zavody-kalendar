import { RobotsDisallowedError } from "./pipeline/http.ts";

/**
 * GET /api/events/<id>/doc?url=<document URL>
 *
 * A race's document for spectators (schedule, map, regulations, poster) served
 * from our origin, so the app's service worker can keep it for use without a
 * signal at the track. Only URLs the race links to (event_links), only PDFs and
 * raster images (never HTML or SVG: they could run script on our origin), fetched
 * politely (robots.txt, own User-Agent) and cached at the edge.
 */

/** Kinds worth having offline; same list as the web app (web/src/offline/plan.ts). */
export const DOC_KINDS = ["harmonogram", "mapa", "divaci", "propozice", "plakat"] as const;

const TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
export const MAX_DOC_BYTES = 15 * 1024 * 1024;
const EDGE_TTL_S = 6 * 3600;

export interface DocDeps {
  db: D1Database;
  /** Polite fetch (robots.txt, User-Agent), see PoliteClient. */
  get: (url: string) => Promise<Response>;
  /** Edge cache (caches.default in the Worker); absent in tests. */
  cache?: Cache;
}

const error = (status: number, message: string) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

/** File name for Content-Disposition: last path segment, ASCII only. */
function fileName(url: URL, ext: string): string {
  const last = decodeURIComponent(url.pathname.split("/").pop() ?? "").normalize("NFD").replace(/\p{M}/gu, "");
  const base = last.replace(/\.[a-z0-9]+$/i, "").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${base || "dokument"}.${ext}`;
}

export async function handleDoc(request: Request, eventId: string, deps: DocDeps): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("url") ?? "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return error(400, "url required");
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return error(400, "http(s) url required");

  const linked = await deps.db
    .prepare(`SELECT 1 AS ok FROM event_links WHERE event_id = ? AND url = ? AND kind IN (${DOC_KINDS.map(() => "?").join(", ")}) LIMIT 1`)
    .bind(eventId, raw, ...DOC_KINDS)
    .first<{ ok: number }>();
  if (!linked) return error(404, "not a document of this race");

  const cached = await deps.cache?.match(request);
  if (cached) return cached;

  let upstream: Response;
  try {
    upstream = await deps.get(target.href);
  } catch (err) {
    if (err instanceof RobotsDisallowedError) return error(403, "robots.txt disallows this document");
    return error(502, "document unreachable");
  }
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return error(502, `document returned ${upstream.status}`);
  }
  const type = (upstream.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) {
    await upstream.body?.cancel();
    return error(415, "not a PDF or image");
  }
  if (Number(upstream.headers.get("Content-Length") ?? 0) > MAX_DOC_BYTES) {
    await upstream.body?.cancel();
    return error(413, "document too large");
  }
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_DOC_BYTES) return error(413, "document too large");

  const res = new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `inline; filename="${fileName(target, ext)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": `public, max-age=${EDGE_TTL_S}`,
    },
  });
  await deps.cache?.put(request, res.clone());
  return res;
}
