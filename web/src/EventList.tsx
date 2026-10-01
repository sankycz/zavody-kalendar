import { useMemo } from "react";
import type { EventListItem, Level } from "../../src/shared/types.ts";
import { dateRange, dayNumber, daysUntil, monthHeading, monthKey, relativeDay, weekdays } from "./format.ts";
import { DisciplineBadge, disciplineStyle } from "./Badges.tsx";
import { formatDistance } from "./distance.ts";
import { LEVEL_LABEL, ORGANIZER_FLAG_LABEL, countryLabel } from "./labels.ts";

export const LEVEL_CLASS: Record<Level, string> = {
  mcr: "bg-mcr/15 text-mcr ring-mcr/30",
  pohar: "bg-pohar/15 text-pohar ring-pohar/30",
  regionalni: "bg-regionalni/15 text-regionalni ring-regionalni/30",
  volny: "bg-volny/15 text-volny ring-volny/30",
};

export function placeLabel(e: Pick<EventListItem, "location_name" | "region" | "country">): string {
  const area = e.country !== "CZ" ? countryLabel(e.country) : e.region;
  // "Praha, Praha" → "Praha"
  return [e.location_name, area && area !== e.location_name ? area : null].filter(Boolean).join(", ");
}

function EventCard({ e, km }: { e: EventListItem; km?: number | undefined }) {
  const cancelled = e.status === "cancelled";
  const finished = e.status === "finished";
  const place = placeLabel(e);
  const soon = relativeDay(e.date_from, e.date_to);
  const upcoming = !cancelled && !finished && daysUntil(e.date_to ?? e.date_from) >= 0;
  // Date badge: full racing color within two weeks, a warm tint for later races, grey for past/cancelled.
  const hot = upcoming && soon != null;
  return (
    <li>
      <a
        href={`/zavod/${e.id}`}
        style={{ ...disciplineStyle(e.discipline), viewTransitionName: `event-${e.id}` }}
        className={`glass card-glow press shine group flex gap-3.5 rounded-2xl p-3 transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-accent sm:p-4 ${
          finished || cancelled ? "opacity-70 hover:opacity-100" : ""
        }`}
      >
        <div
          className={`flex w-14 shrink-0 flex-col items-center justify-center rounded-xl py-2 text-center ${
            hot
              ? "bg-racing text-white shadow-lg shadow-accent/30"
              : upcoming
                ? "bg-accent/10 ring-1 ring-accent/35 ring-inset"
                : "bg-surface-2"
          }`}
        >
          <span className={`text-2xl leading-none font-extrabold tabular-nums ${upcoming && !hot ? "text-racing" : ""}`}>
            {dayNumber(e.date_from)}
          </span>
          <span className={`mt-1 text-xs ${hot ? "text-white/85" : upcoming ? "font-medium text-accent" : "text-muted"}`}>
            {weekdays(e.date_from, e.date_to)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className={`font-semibold leading-snug ${cancelled ? "text-muted line-through" : ""}`}>
            {e.name}
            {km !== undefined && (
              <span className="ml-2 inline-block rounded-full bg-[#0ea5e9]/15 px-2 py-0.5 align-middle text-xs font-bold text-[#0284c7] dark:text-[#38bdf8]">
                {formatDistance(km)}
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-sm text-muted">
            <span className="tabular-nums">{dateRange(e.date_from, e.date_to)}</span>
            {place && <> · {place}</>}
            {hot && <span className="font-semibold text-accent"> · {soon}</span>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <DisciplineBadge d={e.discipline} />
            <span className={`rounded-full px-2.5 py-0.5 font-medium ring-1 ring-inset ${LEVEL_CLASS[e.level]}`}>
              {LEVEL_LABEL[e.level]}
            </span>
            {e.series && <span className="truncate text-muted">{e.series}</span>}
            {e.organizer_flag ? (
              <span className="bg-racing rounded-full px-2.5 py-0.5 font-semibold text-white">
                {ORGANIZER_FLAG_LABEL[e.organizer_flag]}
              </span>
            ) : cancelled ? (
              <span className="bg-racing rounded-full px-2.5 py-0.5 font-semibold text-white">Zrušeno</span>
            ) : (
              finished && <span className="rounded-full bg-surface-2 px-2.5 py-0.5 font-medium text-muted">Proběhlo</span>
            )}
          </div>
        </div>
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-5 w-5 shrink-0 self-center text-muted transition-transform group-hover:translate-x-0.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </a>
    </li>
  );
}

/**
 * Races grouped by month; with `distances` (near me) one list in the given
 * order, nearest first, each with its distance.
 */
export function EventList({ events, distances }: { events: EventListItem[]; distances?: Map<string, number> }) {
  const months = useMemo(() => {
    const groups = new Map<string, EventListItem[]>();
    for (const e of events) {
      const k = monthKey(e.date_from);
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    return [...groups.entries()];
  }, [events]);

  if (distances) {
    return (
      <ul className="space-y-2.5" aria-label="Závody podle vzdálenosti">
        {events.map((e) => (
          <EventCard key={e.id} e={e} km={distances.get(e.id)} />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-7">
      {months.map(([key, items]) => (
        <section key={key} aria-labelledby={`m-${key}`}>
          <h2 id={`m-${key}`} className="sticky top-[4.75rem] z-10 mb-2.5">
            <span className="glass-strong inline-flex items-center gap-2 rounded-full px-3.5 py-1 text-xs font-bold tracking-wider uppercase">
              {monthHeading(items[0]!.date_from)}
              <span className="text-muted">{items.length}</span>
            </span>
          </h2>
          <ul className="space-y-2.5">
            {items.map((e) => (
              <EventCard key={e.id} e={e} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
