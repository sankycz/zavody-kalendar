import type { EventDetail } from "../../src/shared/types.ts";

function icsDate(iso: string): string {
  return iso.replaceAll("-", "");
}

function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

function escape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);
}

/** All-day iCalendar event (DTEND is exclusive). */
export function eventToIcs(e: EventDetail, pageUrl: string): string {
  const place = [e.location_name, e.region].filter(Boolean).join(", ");
  const desc = [e.series, e.organizer && `Pořadatel: ${e.organizer}`, e.website_url, pageUrl].filter(Boolean).join("\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//zavody-kalendar//CS",
    "BEGIN:VEVENT",
    `UID:${e.id}@zavody-kalendar`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icsDate(e.date_from)}`,
    `DTEND;VALUE=DATE:${icsDate(nextDay(e.date_to ?? e.date_from))}`,
    `SUMMARY:${escape(e.name)}`,
    ...(place ? [`LOCATION:${escape(place)}`] : []),
    ...(e.lat != null && e.lng != null ? [`GEO:${e.lat};${e.lng}`] : []),
    `DESCRIPTION:${escape(desc)}`,
    `URL:${pageUrl}`,
    ...(e.status === "cancelled" ? ["STATUS:CANCELLED"] : []),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
