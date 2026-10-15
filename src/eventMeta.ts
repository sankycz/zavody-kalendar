import type { EventDetail } from "./shared/types.ts";
import { DISCIPLINE_LABEL, countryLabel } from "../web/src/labels.ts";

// Link preview of a race page (Facebook, WhatsApp, Messenger, X read only the
// HTML, they don't run the app): its name, date and place go into the title,
// description and og: tags of index.html. The image stays the app's og-image.

const dayMonth = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", timeZone: "UTC" });
const dayMonthYear = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** "16. října 2026", "16.–17. října 2026", "30. září – 1. října 2026" */
export function eventDateText(from: string, to: string | null): string {
  const a = utc(from);
  if (!to || to === from) return dayMonthYear.format(a);
  const b = utc(to);
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${dayMonthYear.format(a)} – ${dayMonthYear.format(b)}`;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}.–${dayMonthYear.format(b)}`;
  return `${dayMonth.format(a)} – ${dayMonthYear.format(b)}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

type MetaEvent = Pick<EventDetail, "name" | "date_from" | "date_to" | "discipline" | "location_name" | "region" | "country" | "status">;

export function eventMeta(e: MetaEvent): { title: string; description: string } {
  const area = e.country !== "CZ" ? countryLabel(e.country) : e.region;
  const place = [e.location_name, area && area !== e.location_name ? area : null].filter(Boolean).join(", ");
  const status = e.status === "cancelled" ? "Zrušeno · " : "";
  return {
    title: e.name,
    description: `${status}${eventDateText(e.date_from, e.date_to)}${place ? ` · ${place}` : ""} · ${DISCIPLINE_LABEL[e.discipline]}`,
  };
}

/** index.html with the race in <title>, description and the og: tags. */
export function eventPageHtml(html: string, e: MetaEvent, pageUrl: string): string {
  const { title, description } = eventMeta(e);
  const set = (s: string, attr: string, value: string) =>
    s.replace(new RegExp(`(<meta ${attr} content=")[^"]*(")`), (_, a: string, b: string) => `${a}${esc(value)}${b}`);
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(`${title} – Závody aut v ČR`)}</title>`);
  out = set(out, 'name="description"', description);
  out = set(out, 'property="og:type"', "article");
  out = set(out, 'property="og:title"', title);
  out = set(out, 'property="og:description"', description);
  out = set(out, 'property="og:url"', pageUrl);
  out = set(out, 'property="og:image:alt"', `${title} – ${description}`);
  return out;
}
