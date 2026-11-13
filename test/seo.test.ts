import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eventJsonLd, eventSeoHtml, homeSeoHtml, sitemapXml } from "../src/seo.ts";

const html = readFileSync(join(import.meta.dirname, "../web/index.html"), "utf8");
const ORIGIN = "https://www.zavody-aut.cz";
const race = {
  id: "0123456789abcdef0123456789abcdef",
  name: "Rallye Miriquidi",
  date_from: "2026-10-16",
  date_to: "2026-10-17",
  discipline: "rally",
  location_name: "Cínovec",
  region: "Ústecký kraj",
  country: "CZ",
  status: "planned",
  organizer: "AMK Miriquidi",
  website_url: "https://example.cz/",
  lat: 50.73,
  lng: 13.76,
} as const;

const ldOf = (out: string) => JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(out)![1]!) as Record<string, unknown>;

describe("search engines", () => {
  it("race page: canonical, SportsEvent and text in #root", () => {
    const url = `${ORIGIN}/zavod/${race.id}`;
    const out = eventSeoHtml(html, race, url, ORIGIN);
    expect(out).toContain(`<link rel="canonical" href="${url}" />`);
    expect(out).toContain('<div id="root"><main><h1>Rallye Miriquidi</h1>');
    expect(out).toContain("Pořadatel: AMK Miriquidi");
    const ld = ldOf(out);
    expect(ld).toMatchObject({ "@type": "SportsEvent", startDate: "2026-10-16", endDate: "2026-10-17", url });
    expect(ld.location).toMatchObject({ geo: { latitude: 50.73, longitude: 13.76 }, address: { addressLocality: "Cínovec" } });
  });

  it("escapes names and cannot close the script", () => {
    const out = eventSeoHtml(html, { ...race, name: 'Rally </script><b>"x"' }, `${ORIGIN}/zavod/x`, ORIGIN);
    expect(out).not.toContain("</script><b>");
    expect(out).toContain("<h1>Rally &#60;/script&#62;&#60;b&#62;&#34;x&#34;</h1>");
    expect(ldOf(out).name).toBe('Rally </script><b>"x"');
  });

  it("cancelled race", () => {
    expect(eventJsonLd({ ...race, status: "cancelled" }, "u", ORIGIN).eventStatus).toBe("https://schema.org/EventCancelled");
  });

  it("home page lists upcoming races", () => {
    const out = homeSeoHtml(html, [race], ORIGIN);
    expect(out).toContain(`<link rel="canonical" href="${ORIGIN}/" />`);
    expect(out).toContain(`<a href="/zavod/${race.id}">Rallye Miriquidi</a>`);
    expect(ldOf(out)).toMatchObject({ "@type": "WebSite", url: `${ORIGIN}/` });
  });

  it("sitemap", () => {
    const xml = sitemapXml(ORIGIN, [{ id: race.id, updated_at: "2026-11-01T10:00:00.000Z" }]);
    expect(xml).toContain(`<loc>${ORIGIN}/zavod/${race.id}</loc><lastmod>2026-11-01</lastmod>`);
    expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
  });
});
