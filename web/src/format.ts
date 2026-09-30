function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

const monthYear = new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" });
const weekday = new Intl.DateTimeFormat("cs-CZ", { weekday: "short" });
const dayMonth = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric" });
const dateTime = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" });

/** "květen 2026" -> "Květen 2026" */
export function monthHeading(iso: string): string {
  const s = monthYear.format(parse(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function dayNumber(iso: string): string {
  return String(parse(iso).getDate());
}

/** "so" or "so–ne" */
export function weekdays(from: string, to: string | null): string {
  const a = weekday.format(parse(from));
  return to ? `${a}–${weekday.format(parse(to))}` : a;
}

/** "22. 5." or "22. 5. – 23. 5." */
export function dateRange(from: string, to: string | null): string {
  const a = dayMonth.format(parse(from));
  return to ? `${a} – ${dayMonth.format(parse(to))}` : a;
}

export function formatTimestamp(iso: string): string {
  return dateTime.format(new Date(iso));
}

const longDate = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });

/** "sobota 16. května 2026" or "pátek 22. 5. – sobota 23. 5. 2026" */
export function longDateRange(from: string, to: string | null): string {
  if (!to) return longDate.format(parse(from));
  return `${weekday.format(parse(from))} ${dayMonth.format(parse(from))} – ${weekday.format(parse(to))} ${shortDate.format(parse(to))}`;
}

/** "16. 5. 2026" */
export function formatDate(iso: string): string {
  return shortDate.format(parse(iso.slice(0, 10)));
}

/** Days from today (local) to the event start; negative when it already started. */
export function daysUntil(iso: string, today = new Date()): number {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((parse(iso).getTime() - t.getTime()) / 86_400_000);
}

export function relativeDay(from: string, to: string | null, today = new Date()): string | null {
  const d = daysUntil(from, today);
  if (d === 0) return "dnes";
  if (d === 1) return "zítra";
  if (d < 0 && to && daysUntil(to, today) >= 0) return "právě probíhá";
  if (d > 1 && d < 5) return `za ${d} dny`;
  if (d >= 5 && d <= 14) return `za ${d} dní`;
  return null;
}
