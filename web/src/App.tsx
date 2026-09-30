import { useEffect, useMemo, useState } from "react";
import type { EventListItem, EventsResponse, Level } from "../../src/shared/types.ts";
import { dateRange, dayNumber, formatTimestamp, monthHeading, monthKey, weekdays } from "./format.ts";
import { DISCIPLINE_LABEL, LEVEL_LABEL, countryLabel } from "./labels.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: EventsResponse };

const LEVEL_CLASS: Record<Level, string> = {
  mcr: "bg-mcr/12 text-mcr ring-mcr/30",
  pohar: "bg-pohar/12 text-pohar ring-pohar/30",
  regionalni: "bg-regionalni/12 text-regionalni ring-regionalni/30",
  volny: "bg-volny/12 text-volny ring-volny/30",
};

function useEvents(): State {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/events${window.location.search}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Server vrátil ${res.status}`);
        setState({ kind: "ready", data: (await res.json()) as EventsResponse });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, []);
  return state;
}

function EventCard({ e }: { e: EventListItem }) {
  const cancelled = e.status === "cancelled";
  const place = [e.location_name, e.country !== "CZ" ? countryLabel(e.country) : e.region].filter(Boolean).join(", ");
  return (
    <li className="flex gap-3 rounded-xl border border-border bg-surface p-3 sm:p-4">
      <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-surface-2 py-2 text-center">
        <span className="text-2xl leading-none font-bold tabular-nums">{dayNumber(e.date_from)}</span>
        <span className="mt-1 text-xs text-muted">{weekdays(e.date_from, e.date_to)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className={`font-semibold leading-snug ${cancelled ? "text-muted line-through" : ""}`}>{e.name}</h3>
        <p className="mt-0.5 text-sm text-muted">
          <span className="tabular-nums">{dateRange(e.date_from, e.date_to)}</span>
          {place && <> · {place}</>}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded-md bg-surface-2 px-2 py-0.5 font-medium">{DISCIPLINE_LABEL[e.discipline]}</span>
          <span className={`rounded-md px-2 py-0.5 font-medium ring-1 ring-inset ${LEVEL_CLASS[e.level]}`}>
            {LEVEL_LABEL[e.level]}
          </span>
          {e.series && <span className="truncate text-muted">{e.series}</span>}
          {cancelled && <span className="rounded-md bg-accent px-2 py-0.5 font-semibold text-accent-fg">Zrušeno</span>}
        </div>
      </div>
    </li>
  );
}

function EventList({ events }: { events: EventListItem[] }) {
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

export function App() {
  const state = useEvents();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <h1 className="flex items-center gap-2 text-lg font-bold">
            <span aria-hidden className="inline-block h-4 w-1.5 rounded-sm bg-accent" />
            Závody aut v ČR
          </h1>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-2 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {state.kind === "loading" && <p className="py-10 text-center text-muted">Načítám závody…</p>}

        {state.kind === "error" && (
          <div role="alert" className="mt-6 rounded-xl border border-border bg-surface p-4">
            <p className="font-semibold">Závody se nepodařilo načíst.</p>
            <p className="mt-1 text-sm text-muted">{state.message}</p>
          </div>
        )}

        {state.kind === "ready" &&
          (state.data.events.length === 0 ? (
            <p className="py-10 text-center text-muted">
              Zatím tu nejsou žádné nadcházející závody.
              {!state.data.last_ingest_at && " Data se objeví po prvním stažení zdrojů."}
            </p>
          ) : (
            <EventList events={state.data.events} />
          ))}

        {state.kind === "ready" && state.data.last_ingest_at && (
          <p className="mt-8 text-center text-xs text-muted">
            Data naposledy aktualizována {formatTimestamp(state.data.last_ingest_at)}
          </p>
        )}
      </main>
    </div>
  );
}
