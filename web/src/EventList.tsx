import { useMemo } from "react";
import type { EventListItem, Level } from "../../src/shared/types.ts";
import { dateRange, dayNumber, monthHeading, monthKey, relativeDay, weekdays } from "./format.ts";
import { DISCIPLINE_LABEL, LEVEL_LABEL, ORGANIZER_FLAG_LABEL, countryLabel } from "./labels.ts";

export const LEVEL_CLASS: Record<Level, string> = {
  mcr: "bg-mcr/15 text-mcr ring-mcr/30",
  pohar: "bg-pohar/15 text-pohar ring-pohar/30",
  regionalni: "bg-regionalni/15 text-regionalni ring-regionalni/30",
  volny: "bg-volny/15 text-volny ring-volny/30",
};

export function placeLabel(e: Pick<EventListItem, "location_name" | "region" | "country">): string {
  return [e.location_name, e.country !== "CZ" ? countryLabel(e.country) : e.region].filter(Boolean).join(", ");
}

function EventCard({ e }: { e: EventListItem }) {
  const cancelled = e.status === "cancelled";
  const finished = e.status === "finished";
  const place = placeLabel(e);
  const soon = relativeDay(e.date_from, e.date_to);
  const hot = soon != null && !cancelled && !finished;
  return (
    <li>
      <a
        href={`/zavod/${e.id}`}
        className={`glass group flex gap-3.5 rounded-2xl p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-2 focus-visible:outline-accent sm:p-4 ${
          finished || cancelled ? "opacity-70 hover:opacity-100" : ""
        }`}
      >
        <div
          className={`flex w-14 shrink-0 flex-col items-center justify-center rounded-xl py-2 text-center ${
            hot ? "bg-racing text-white shadow-lg shadow-accent/30" : "bg-surface-2"
          }`}
        >
          <span className="text-2xl leading-none font-extrabold tabular-nums">{dayNumber(e.date_from)}</span>
          <span className={`mt-1 text-xs ${hot ? "text-white/85" : "text-muted"}`}>{weekdays(e.date_from, e.date_to)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className={`font-semibold leading-snug ${cancelled ? "text-muted line-through" : ""}`}>{e.name}</h3>
          <p className="mt-0.5 text-sm text-muted">
            <span className="tabular-nums">{dateRange(e.date_from, e.date_to)}</span>
            {place && <> · {place}</>}
            {hot && <span className="font-semibold text-accent"> · {soon}</span>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-full bg-surface-2 px-2.5 py-0.5 font-medium">{DISCIPLINE_LABEL[e.discipline]}</span>
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

export function EventList({ events }: { events: EventListItem[] }) {
  const months = useMemo(() => {
    const groups = new Map<string, EventListItem[]>();
    for (const e of events) {
      const k = monthKey(e.date_from);
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    return [...groups.entries()];
  }, [events]);

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
