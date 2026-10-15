/**
 * Where a page request on an old address (workers.dev, the bare domain) moves to
 * the main one, or null. API and admin stay on every address: installed apps,
 * offline copies and admin scripts keep working.
 */
export function canonicalUrl(url: URL, canonicalHost: string | undefined): string | null {
  if (!canonicalHost || url.host === canonicalHost) return null;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin/")) return null;
  const alias = url.hostname.endsWith(".workers.dev") || url.hostname === canonicalHost.replace(/^www\./, "");
  return alias ? `https://${canonicalHost}${url.pathname}${url.search}` : null;
}
