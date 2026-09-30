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
