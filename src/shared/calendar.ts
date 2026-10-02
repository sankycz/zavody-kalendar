// Calendar entries for a race: Google Calendar link and iCalendar (Apple Calendar,
// Outlook…), both all-day. Shared by the Worker (GET /api/events/<id>/ics) and the web.
import type { EventDetail } from "./types.ts";

type CalendarEvent = Pick<EventDetail, "id" | "name" | "date_from" | "date_to" | "location_name" | "region" | "series" | "organizer" | "website_url" | "lat" | "lng" | "status">;

function compact(iso: string): string {
  return iso.replaceAll("-", "");
}

function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function place(e: CalendarEvent): string {
  return [e.location_name, e.region].filter(Boolean).join(", ");
}

function description(e: CalendarEvent, pageUrl: string): string {
  return [e.series, e.organizer && `Pořadatel: ${e.organizer}`, e.website_url, pageUrl].filter(Boolean).join("\n");
}

/** "Add to Google Calendar" link: opens the prefilled event, nothing is downloaded. */
export function googleCalendarUrl(e: CalendarEvent, pageUrl: string): string {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: e.status === "cancelled" ? `ZRUŠENO: ${e.name}` : e.name,
    // All-day: the end date is exclusive.
    dates: `${compact(e.date_from)}/${compact(nextDay(e.date_to ?? e.date_from))}`,
    details: description(e, pageUrl),
    ctz: "Europe/Prague",
  });
  if (place(e)) p.set("location", place(e));
  return `https://calendar.google.com/calendar/render?${p}`;
}

function escape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);
}

/** Lines longer than 75 octets are folded (RFC 5545 3.1), never inside a UTF-8 character. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

/** All-day iCalendar event (DTEND is exclusive). */
export function eventToIcs(e: CalendarEvent, pageUrl: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//zavody-kalendar//CS",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@zavody-kalendar`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(e.date_from)}`,
    `DTEND;VALUE=DATE:${compact(nextDay(e.date_to ?? e.date_from))}`,
    `SUMMARY:${escape(e.name)}`,
    ...(place(e) ? [`LOCATION:${escape(place(e))}`] : []),
    ...(e.lat != null && e.lng != null ? [`GEO:${e.lat};${e.lng}`] : []),
    `DESCRIPTION:${escape(description(e, pageUrl))}`,
    `URL:${pageUrl}`,
    ...(e.status === "cancelled" ? ["STATUS:CANCELLED"] : []),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(fold)
    .join("\r\n");
}
