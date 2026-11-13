import type { EventDetail } from "./shared/types.ts";
import { DISCIPLINE_LABEL, countryLabel } from "../web/src/labels.ts";
import { eventMeta } from "./eventMeta.ts";

// For search engines: canonical address, structured data (schema.org) and the race's text right in the
// HTML of its page (Seznam and others don't run the app; React replaces it when the app starts),
// the list of upcoming races on the home page and sitemap.xml with every race page.

export type SeoEvent = Pick<
  EventDetail,
  "name" | "date_from" | "date_to" | "discipline" | "location_name" | "region" | "country" | "status"
> &
  Partial<Pick<EventDetail, "organizer" | "website_url" | "description" | "lat" | "lng">>;

export type SeoListEvent = SeoEvent & { id: string };

const SITE_NAME = "Závody aut v ČR";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** JSON inside <script>: no "</script>" breakout. */
function jsonLd(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

function inHead(html: string, extra: string): string {
  return html.replace("</head>", `    ${extra}\n  </head>`);
}

function inRoot(html: string, content: string): string {
  return html.replace('<div id="root"></div>', `<div id="root">${content}</div>`);
}

export function eventJsonLd(e: SeoEvent, pageUrl: string, origin: string): Record<string, unknown> {
  const { description } = eventMeta(e);
  const area = e.country !== "CZ" ? countryLabel(e.country) : e.region;
  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: e.name,
    description,
    sport: `Motorsport – ${DISCIPLINE_LABEL[e.discipline]}`,
    startDate: e.date_from,
    endDate: e.date_to ?? e.date_from,
    eventStatus: e.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    url: pageUrl,
    image: `${origin}/og-image.png`,
    location: {
      "@type": "Place",
      name: e.location_name ?? area ?? countryLabel(e.country),
      address: {
        "@type": "PostalAddress",
        ...(e.location_name ? { addressLocality: e.location_name } : {}),
        ...(e.region ? { addressRegion: e.region } : {}),
        addressCountry: e.country,
      },
      ...(e.lat != null && e.lng != null ? { geo: { "@type": "GeoCoordinates", latitude: e.lat, longitude: e.lng } } : {}),
    },
    ...(e.organizer ? { organizer: { "@type": "Organization", name: e.organizer, ...(e.website_url ? { url: e.website_url } : {}) } } : {}),
  };
}

/** Race page: canonical link, SportsEvent data and the race's text inside #root. */
export function eventSeoHtml(html: string, e: SeoEvent, pageUrl: string, origin: string): string {
  const { description } = eventMeta(e);
  const body = [
    `<main><h1>${esc(e.name)}</h1>`,
    `<p>${esc(description)}</p>`,
    e.organizer ? `<p>Pořadatel: ${esc(e.organizer)}</p>` : "",
    e.description ? `<p>${esc(e.description)}</p>` : "",
    e.website_url ? `<p><a href="${esc(e.website_url)}" rel="nofollow">Web pořadatele</a></p>` : "",
    `<p><a href="/">Kalendář závodů aut v ČR</a></p></main>`,
  ].join("");
  const head = `<link rel="canonical" href="${esc(pageUrl)}" />\n    ${jsonLd(eventJsonLd(e, pageUrl, origin))}`;
  return inRoot(inHead(html, head), body);
}

/** Home page: canonical link, WebSite data and links to the upcoming races inside #root. */
export function homeSeoHtml(html: string, events: SeoListEvent[], origin: string): string {
  const items = events
    .map((e) => `<li><a href="/zavod/${e.id}">${esc(e.name)}</a> – ${esc(eventMeta(e).description)}</li>`)
    .join("");
  const body =
    `<main><h1>${SITE_NAME} – kalendář automobilových závodů</h1>` +
    `<p>Rally, závody do vrchu, autokros, slalom, okruhy a drift v Česku a okolí. Termíny, místa na mapě a odkazy na pořadatele.</p>` +
    (items ? `<h2>Nejbližší závody</h2><ul>${items}</ul>` : "") +
    `</main>`;
  const site = { "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: `${origin}/`, inLanguage: "cs" };
  return inRoot(inHead(html, `<link rel="canonical" href="${origin}/" />\n    ${jsonLd(site)}`), body);
}

export function sitemapXml(origin: string, events: { id: string; updated_at: string }[]): string {
  const urls = [
    `<url><loc>${origin}/</loc><changefreq>daily</changefreq></url>`,
    ...events.map((e) => `<url><loc>${origin}/zavod/${e.id}</loc><lastmod>${e.updated_at.slice(0, 10)}</lastmod></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>\n`;
}
