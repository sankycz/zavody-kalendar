const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/**
 * Turn a calendar page into plain text for the model: drop scripts, styles,
 * navigation, header, footer and sidebars; keep table rows on one line and
 * keep link targets (organizer websites) as "text (url)".
 */
export function htmlToText(html: string, baseUrl?: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ");

  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(s) ?? /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(s);
  if (main && main[1]!.length > 200) s = main[1]!;

  s = s.replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, href: string, text: string) => {
    let url = href.trim();
    if (/^(mailto:|tel:|javascript:|#)/i.test(url)) return text;
    try {
      if (baseUrl) url = new URL(url, baseUrl).toString();
    } catch {
      return text;
    }
    const inner = text.replace(/<[^>]+>/g, "").trim();
    return inner ? `${inner} (${url})` : url;
  });

  s = s.replace(/<\/(td|th)\s*>/gi, " | ");
  s = s.replace(/<(br|hr)\b[^>]*>/gi, "\n");
  s = s.replace(/<\/?(p|div|tr|li|ul|ol|table|thead|tbody|h[1-6]|section|dl|dt|dd)\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);

  return s
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").replace(/(\s*\|\s*)+$/, "").trim())
    .filter((l) => l && l !== "|")
    .join("\n");
}
