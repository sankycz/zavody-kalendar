/**
 * "Next page" link of a paginated listing (sources with max_pages > 1): an
 * <a> with rel="next", a class "next", or the text ›, », >, Další / Next.
 * Same host only. Generic, no per-site rules.
 */
const NEXT_TEXT = new Set(["›", "»", ">", "další", "dalsi", "next", "další ›", "další »", "next ›", "next »"]);

function decodeEntities(s: string): string {
  return s
    .replace(/&rsaquo;/gi, "›")
    .replace(/&raquo;/gi, "»")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    // Numeric references, e.g. WordPress writes & in URLs as &#038;.
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/gi, "&");
}

export function nextPageUrl(html: string, base: string): string | null {
  const host = new URL(base).host;
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1]!;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!href || href.startsWith("#")) continue;
    const rel = /\brel\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
    const cls = /\bclass\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
    const text = decodeEntities(m[2]!.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim().toLowerCase();
    const isNext = /\bnext\b/i.test(rel) || /(^|\s)next(\s|$)/i.test(cls) || NEXT_TEXT.has(text);
    if (!isNext) continue;
    try {
      const url = new URL(decodeEntities(href), base);
      if (url.host === host && url.toString() !== base) return url.toString();
    } catch {
      /* not a URL */
    }
  }
  return null;
}
