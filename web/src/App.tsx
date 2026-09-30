import { Suspense, lazy } from "react";
import type { EventsResponse } from "../../src/shared/types.ts";
import { EventDetailPage } from "./EventDetail.tsx";
import { EventList } from "./EventList.tsx";
import { FilterBar } from "./FilterBar.tsx";
import { activeFilterCount, eventsApiUrl, listHref, parseFilters, type Filters } from "./filters.ts";
import { formatTimestamp } from "./format.ts";
import { navigate, useLocation } from "./router.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { useJson } from "./useJson.ts";

const EventMap = lazy(() => import("./EventMap.tsx"));

function count(n: number): string {
  if (n === 1) return "1 závod";
  if (n >= 2 && n <= 4) return `${n} závody`;
  return `${n} závodů`;
}

function ListPage({ filters }: { filters: Filters }) {
  const state = useJson<EventsResponse>(eventsApiUrl(filters));
  const onChange = (f: Filters) => navigate(listHref(f), { replace: true });

  return (
    <>
      <div className="pt-3">
        <FilterBar filters={filters} onChange={onChange} />
      </div>

      {state.kind === "loading" && <p className="py-10 text-center text-muted">Načítám závody…</p>}

      {state.kind === "error" && (
        <div role="alert" className="mt-6 rounded-xl border border-border bg-surface p-4">
          <p className="font-semibold">Závody se nepodařilo načíst.</p>
          <p className="mt-1 text-sm text-muted">{state.message}</p>
        </div>
      )}

      {state.kind === "ready" && (
        <>
          <p className="py-3 text-sm text-muted" aria-live="polite">
            {count(state.data.events.length)}
            {activeFilterCount(filters) > 0 ? " podle filtrů" : " v kalendáři"}
          </p>

          {state.data.events.length === 0 ? (
            <p className="py-10 text-center text-muted">
              {activeFilterCount(filters) > 0
                ? "Filtrům neodpovídá žádný závod."
                : "Zatím tu nejsou žádné nadcházející závody."}
              {!state.data.last_ingest_at && " Data se objeví po prvním stažení zdrojů."}
            </p>
          ) : filters.view === "map" ? (
            <>
              <Suspense fallback={<div className="h-[65dvh] rounded-xl border border-border bg-surface-2" />}>
                <EventMap events={state.data.events} className="h-[65dvh] min-h-80" />
              </Suspense>
              {(() => {
                const missing = state.data.events.filter((e) => e.lat == null || e.lng == null).length;
                return missing > 0 ? (
                  <p className="mt-2 text-sm text-muted">
                    {count(missing)} bez známé polohy –{" "}
                    <a href={listHref({ ...filters, view: "list" })} className="underline underline-offset-2">
                      zobrazit v seznamu
                    </a>
                    .
                  </p>
                ) : null;
              })()}
            </>
          ) : (
            <EventList events={state.data.events} />
          )}

          {state.data.last_ingest_at && (
            <p className="mt-8 text-center text-xs text-muted">
              Data se aktualizují každý den, naposledy {formatTimestamp(state.data.last_ingest_at)}
            </p>
          )}
        </>
      )}
    </>
  );
}

export function App() {
  const loc = useLocation();
  const detail = /^\/zavod\/([0-9a-f]{32})\/?$/.exec(loc.pathname);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2 text-lg font-bold">
            <span aria-hidden className="inline-block h-4 w-1.5 rounded-sm bg-accent" />
            Závody aut v ČR
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {detail ? <EventDetailPage key={detail[1]} id={detail[1]!} /> : <ListPage filters={parseFilters(loc.searchParams)} />}
      </main>
    </div>
  );
}
