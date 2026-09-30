import { useMemo } from "react";
import type { EventListItem, Level } from "../../src/shared/types.ts";
import { dateRange, dayNumber, monthHeading, monthKey, relativeDay, weekdays } from "./format.ts";
import { DISCIPLINE_LABEL, LEVEL_LABEL, ORGANIZER_FLAG_LABEL, countryLabel } from "./labels.ts";

export const LEVEL_CLASS: Record<Level, string> = {
  mcr: "bg-mcr/12 text-mcr ring-mcr/30",
  pohar: "bg-pohar/12 text-pohar ring-pohar/30",
  regionalni: "bg-regionalni/12 text-regionalni ring-regionalni/30",
  volny: "bg-volny/12 text-volny ring-volny/30",
};

export function placeLabel(e: Pick<EventListItem, "location_name" | "region" | "country">): string {
  return [e.location_name, e.country !== "CZ" ? countryLabel(e.country) : e.region].filter(Boolean).join(", ");
}

function EventCard({ e }: { e: EventListItem }) {
  const cancelled = e.status === "cancelled";
  const place = placeLabel(e);
  const soon = relativeDay(e.date_from, e.date_to);
  return (
    <li>
      <a
        href={`/zavod/${e.id}`}
        className="flex gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-muted focus-visible:outline-2 focus-visible:outline-accent sm:p-4"
      >
        <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-surface-2 py-2 text-center">
          <span className="text-2xl leading-none font-bold tabular-nums">{dayNumber(e.date_from)}</span>
          <span className="mt-1 text-xs text-muted">{weekdays(e.date_from, e.date_to)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className={`font-semibold leading-snug ${cancelled ? "text-muted line-through" : ""}`}>{e.name}</h3>
          <p className="mt-0.5 text-sm text-muted">
            <span className="tabular-nums">{dateRange(e.date_from, e.date_to)}</span>
            {place && <> · {place}</>}
            {soon && !cancelled && <span className="font-semibold text-accent"> · {soon}</span>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-md bg-surface-2 px-2 py-0.5 font-medium">{DISCIPLINE_LABEL[e.discipline]}</span>
            <span className={`rounded-md px-2 py-0.5 font-medium ring-1 ring-inset ${LEVEL_CLASS[e.level]}`}>
              {LEVEL_LABEL[e.level]}
            </span>
            {e.series && <span className="truncate text-muted">{e.series}</span>}
            {e.organizer_flag ? (
              <span className="rounded-md bg-accent px-2 py-0.5 font-semibold text-accent-fg">
                {ORGANIZER_FLAG_LABEL[e.organizer_flag]}
              </span>
            ) : (
              cancelled && <span className="rounded-md bg-accent px-2 py-0.5 font-semibold text-accent-fg">Zrušeno</span>
            )}
          </div>
        </div>
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
    <div className="space-y-6">
      {months.map(([key, items]) => (
        <section key={key} aria-labelledby={`m-${key}`}>
          <h2
            id={`m-${key}`}
            className="sticky top-14 z-10 -mx-4 bg-bg/95 px-4 py-2 text-sm font-semibold tracking-wide text-muted uppercase backdrop-blur"
          >
            {monthHeading(items[0]!.date_from)}
          </h2>
          <ul className="space-y-2">
            {items.map((e) => (
              <EventCard key={e.id} e={e} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
