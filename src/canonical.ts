/**
 * Where a page request moves to, or null: from an old address (workers.dev, the
 * bare domain) or plain http to https on the main one. API and admin stay on
 * every address: installed apps, offline copies and admin scripts keep working.
 */
export function canonicalUrl(url: URL, canonicalHost: string | undefined): string | null {
  if (!canonicalHost) return null;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin/")) return null;
  const main = url.host === canonicalHost;
  const alias = url.hostname.endsWith(".workers.dev") || url.hostname === canonicalHost.replace(/^www\./, "");
  if (!alias && !(main && url.protocol === "http:")) return null;
  return `https://${canonicalHost}${url.pathname}${url.search}`;
}
