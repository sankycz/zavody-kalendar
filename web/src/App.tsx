import { useCallback, useEffect, useMemo, useState } from "react";
import type { EventListItem, EventsResponse } from "../../src/shared/types.ts";
import { EventDetailPage } from "./EventDetail.tsx";
import { EventList } from "./EventList.tsx";
import { Dock } from "./Dock.tsx";
import { FilterBar, FilterPanel } from "./FilterBar.tsx";
import { activeFilterCount, eventsApiUrl, listHref, parseFilters, seasonOf, seasonRange, type Filters } from "./filters.ts";
import { formatTimestamp } from "./format.ts";
import { distanceKm } from "./distance.ts";
import { usePosition } from "./geo.ts";
import { Intro } from "./Intro.tsx";
import { MapView } from "./MapView.tsx";
import { NextRace, nextRace } from "./NextRace.tsx";
import { navigate, useLocation } from "./router.ts";
import { Sheet } from "./Sheet.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { useJson } from "./useJson.ts";

function count(n: number): string {
  if (n === 1) return "1 závod";
  if (n >= 2 && n <= 4) return `${n} závody`;
  return `${n} závodů`;
}

/** Upcoming, or a whole season – this year and any later one that already has races. */
function ScopeToggle({ filters, seasons, onChange }: { filters: Filters; seasons: number[]; onChange: (f: Filters) => void }) {
  const thisYear = new Date().getFullYear();
  const years = [...new Set([thisYear, ...seasons.filter((y) => y >= thisYear)])].sort();
  const current = seasonOf(filters);
  const opts = [
    { key: "upcoming", label: "Nadcházející", on: !filters.from && !filters.to, range: { from: "", to: "" } },
    ...years.map((y) => ({ key: String(y), label: `Sezóna ${y}`, on: current === y, range: seasonRange(y) })),
  ];
  return (
    <div role="group" aria-label="Rozsah" className="glass flex max-w-full overflow-x-auto rounded-full p-1">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={o.on}
          onClick={() => onChange({ ...filters, ...o.range })}
          className={`min-h-8 shrink-0 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-all ${
            o.on ? "bg-racing text-white shadow-md shadow-accent/30" : "text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ListPage({ filters }: { filters: Filters }) {
  const state = useJson<EventsResponse>(eventsApiUrl(filters));
  const onChange = (f: Filters) => navigate(listHref(f), { replace: true });
  const geo = usePosition();
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  // Seasons stay known while the next filter loads.
  const [seasons, setSeasons] = useState<number[]>([]);
  useEffect(() => {
    if (state.kind === "ready") setSeasons(state.data.seasons ?? []);
  }, [state]);

  // Arriving at ?sort=near in a new visit: ask for the position again.
  useEffect(() => {
    if (filters.sort === "near" && geo.state === "idle") void geo.request();
  }, [filters.sort, geo]);

  const toggleNear = async () => {
    setGeoMessage(null);
    if (filters.sort === "near") return onChange({ ...filters, sort: "date" });
    const pos = await geo.request();
    if (pos) onChange({ ...filters, sort: "near" });
    else setGeoMessage("Polohu se nepodařilo zjistit. Povolte prosím přístup k poloze v prohlížeči.");
  };

  const near = filters.sort === "near" ? geo.pos : null;
  const all = state.kind === "ready" ? state.data.events : [];
  const distances = useMemo(() => {
    if (!near) return undefined;
    const m = new Map<string, number>();
    for (const e of all) if (e.lat != null && e.lng != null) m.set(e.id, distanceKm(near, { lat: e.lat, lng: e.lng }));
    return m;
  }, [all, near]);
  const events: EventListItem[] = useMemo(
    () => (distances ? [...all].sort((a, b) => (distances.get(a.id) ?? Infinity) - (distances.get(b.id) ?? Infinity)) : all),
    [all, distances],
  );
  const highlight =
    state.kind === "ready" && filters.view === "list" && !near && !filters.from && !filters.to && activeFilterCount(filters) === 0
      ? nextRace(all)
      : null;

  const filterCount = activeFilterCount(filters);
  const nearOn = filters.sort === "near";
  const nearBusy = geo.state === "asking";
  const filterSheet = (
    <Sheet open={sheetOpen} title="Filtry" onClose={closeSheet}>
      <FilterPanel filters={filters} onChange={onChange} />
      <button type="button" onClick={closeSheet} className="bg-racing press mt-6 min-h-12 w-full rounded-2xl font-bold text-white shadow-lg shadow-accent/30">
        {state.kind === "ready" ? `Zobrazit ${count(state.data.events.length)}` : "Hotovo"}
      </button>
    </Sheet>
  );
  const dock = (
    <Dock
      view={filters.view}
      onView={(view) => onChange({ ...filters, view })}
      near={nearOn}
      nearBusy={nearBusy}
      onToggleNear={toggleNear}
      filterCount={filterCount}
      onFilters={openSheet}
    />
  );
  const bar = (
    <FilterBar filters={filters} onChange={onChange} near={nearOn} nearBusy={nearBusy} onToggleNear={toggleNear} onOpenFilters={openSheet} />
  );
  const geoNote = geoMessage && (
    <p role="status" className="glass-strong mt-2 rounded-xl px-3 py-2 text-sm text-accent">
      {geoMessage}
    </p>
  );

  if (filters.view === "map") {
    return (
      <>
        <MapView
          events={events}
          me={near}
          distances={distances}
          top={
            <>
              <div className="flex flex-wrap items-center gap-2">
                <ScopeToggle filters={filters} seasons={seasons} onChange={onChange} />
                {state.kind === "ready" && (
                  <span className="glass-strong rounded-full px-3 py-1.5 text-sm font-medium" aria-live="polite">
                    {count(events.filter((e) => e.lat != null).length)} na mapě
                  </span>
                )}
              </div>
              {bar}
              {geoNote}
            </>
          }
        />
        {dock}
        {filterSheet}
      </>
    );
  }

  return (
    <>
      <section className="pt-6 pb-4 sm:pt-10">
        <h1 className="text-3xl leading-tight font-extrabold tracking-tight sm:text-4xl">
          Závody aut <span className="text-racing">v Česku</span>
        </h1>
        <p className="mt-1.5 text-muted">Rally, vrchy, okruhy, autokros a slalom na jednom místě.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ScopeToggle filters={filters} seasons={seasons} onChange={onChange} />
          {state.kind === "ready" && (
            <span className="text-sm text-muted" aria-live="polite">
              {count(state.data.events.length)}
              {filterCount > 0 ? " podle filtrů" : ""}
            </span>
          )}
        </div>
      </section>

      {highlight && <NextRace event={highlight} />}

      {bar}
      {geoNote}

      {state.kind === "loading" && (
        <ul className="mt-5 space-y-2.5" aria-label="Načítám závody…">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="glass h-[5.5rem] animate-pulse rounded-2xl" />
          ))}
        </ul>
      )}

      {state.kind === "error" && (
        <div role="alert" className="glass mt-6 rounded-2xl p-4">
          <p className="font-semibold">Závody se nepodařilo načíst.</p>
          <p className="mt-1 text-sm text-muted">{state.message}</p>
        </div>
      )}

      {state.kind === "ready" && (
        <div className="mt-5">
          {events.length === 0 ? (
            <div className="glass rounded-2xl px-4 py-10 text-center text-muted">
              {filterCount > 0 ? "Filtrům neodpovídá žádný závod." : "Zatím tu nejsou žádné nadcházející závody."}
              {!state.data.last_ingest_at && " Data se objeví po prvním stažení zdrojů."}
              {filterCount > 0 && (
                <button type="button" onClick={openSheet} className="mt-3 block w-full text-sm font-semibold text-accent">
                  Upravit filtry
                </button>
              )}
            </div>
          ) : (
            <EventList events={events} {...(distances ? { distances } : {})} />
          )}

          {state.data.last_ingest_at && (
            <p className="mt-10 text-center text-xs text-muted">
              Data se aktualizují každé pondělí, naposledy {formatTimestamp(state.data.last_ingest_at)}
            </p>
          )}
        </div>
      )}
      {dock}
      {filterSheet}
    </>
  );
}

/** Moving color behind the glass (styled in index.css). */
function Orbs() {
  return (
    <div className="orbs" aria-hidden>
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

export function App() {
  const loc = useLocation();
  const detail = /^\/zavod\/([0-9a-f]{32})\/?$/.exec(loc.pathname);

  return (
    <div className="min-h-dvh">
      <Orbs />
      <Intro />
      <header className="sticky top-0 z-30 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="glass-strong mx-auto flex h-14 max-w-3xl items-center justify-between rounded-2xl pr-2 pl-4">
          <a href="/" className="flex items-center gap-2.5 font-bold tracking-tight">
            <span aria-hidden className="bg-racing grid h-8 w-8 place-items-center rounded-xl shadow-md shadow-accent/30">
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
              </svg>
            </span>
            Závody aut v ČR
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-[max(7.5rem,calc(env(safe-area-inset-bottom)+6.5rem))] sm:pb-10">
        {detail ? <EventDetailPage key={detail[1]} id={detail[1]!} /> : <ListPage filters={parseFilters(loc.searchParams)} />}
      </main>
    </div>
  );
}
