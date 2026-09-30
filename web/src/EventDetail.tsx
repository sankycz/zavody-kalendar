import { Suspense, lazy, useEffect } from "react";
import type { EventDetail as Detail } from "../../src/shared/types.ts";
import { placeLabel, LEVEL_CLASS } from "./EventList.tsx";
import { formatDate, formatTimestamp, longDateRange, relativeDay } from "./format.ts";
import { eventToIcs } from "./ics.ts";
import { DISCIPLINE_LABEL, LEVEL_LABEL, countryLabel } from "./labels.ts";
import { canGoBack, navigate } from "./router.ts";
import { useJson } from "./useJson.ts";

const EventMap = lazy(() => import("./EventMap.tsx"));

const STATUS_LABEL = { planned: null, cancelled: "Zrušeno", finished: "Proběhlo" } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-2.5 sm:grid-cols-[10rem_1fr]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

const btnBase = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium";
const btnClass = `${btnBase} border-border bg-surface hover:bg-surface-2`;
const btnPrimary = `${btnBase} border-fg bg-fg text-bg hover:opacity-90`;

function downloadIcs(e: Detail) {
  const blob = new Blob([eventToIcs(e, window.location.href)], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${e.date_from}-${e.name.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\w]+/g, "-").toLowerCase()}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function share(e: Detail) {
  const data = { title: e.name, text: `${e.name} – ${longDateRange(e.date_from, e.date_to)}`, url: window.location.href };
  try {
    if (navigator.share) await navigator.share(data);
    else await navigator.clipboard.writeText(data.url);
  } catch {
    /* user cancelled */
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function EventDetailPage({ id }: { id: string }) {
  const state = useJson<Detail>(`/api/events/${id}`);

  useEffect(() => {
    if (state.kind === "ready") document.title = `${state.data.name} – Závody aut v ČR`;
    return () => {
      document.title = "Závody aut v ČR";
    };
  }, [state]);

  const back = (
    <a
      href="/"
      data-native
      onClick={(ev) => {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
        ev.preventDefault();
        if (canGoBack()) history.back();
        else navigate("/");
      }}
      className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-muted hover:text-fg"
    >
      <span aria-hidden>←</span> Zpět na závody
    </a>
  );

  if (state.kind === "loading") return <div className="pt-2">{back}<p className="py-10 text-center text-muted">Načítám závod…</p></div>;
  if (state.kind === "error") {
    return (
      <div className="pt-2">
        {back}
        <div role="alert" className="mt-4 rounded-xl border border-border bg-surface p-4">
          <p className="font-semibold">{state.status === 404 ? "Závod nebyl nalezen." : "Závod se nepodařilo načíst."}</p>
          {state.status !== 404 && <p className="mt-1 text-sm text-muted">{state.message}</p>}
          <button type="button" className={`${btnClass} mt-3`} onClick={() => navigate("/")}>
            Na seznam závodů
          </button>
        </div>
      </div>
    );
  }

  const e = state.data;
  const status = STATUS_LABEL[e.status];
  const soon = e.status === "planned" ? relativeDay(e.date_from, e.date_to) : null;
  const hasPoint = e.lat != null && e.lng != null;
  const place = placeLabel(e);

  return (
    <article className="pt-2">
      {back}

      <header className="mt-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded-md bg-surface-2 px-2 py-0.5 font-medium">{DISCIPLINE_LABEL[e.discipline]}</span>
          <span className={`rounded-md px-2 py-0.5 font-medium ring-1 ring-inset ${LEVEL_CLASS[e.level]}`}>{LEVEL_LABEL[e.level]}</span>
          {status && (
            <span className={`rounded-md px-2 py-0.5 font-semibold ${e.status === "cancelled" ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted"}`}>
              {status}
            </span>
          )}
        </div>
        <h1 className={`mt-2 text-2xl leading-tight font-bold ${e.status === "cancelled" ? "text-muted line-through" : ""}`}>{e.name}</h1>
        <p className="mt-1 text-base first-letter:uppercase">
          {longDateRange(e.date_from, e.date_to)}
          {soon && <span className="font-semibold text-accent"> · {soon}</span>}
        </p>
        {place && <p className="text-muted">{place}</p>}
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        {e.website_url && (
          <a href={e.website_url} target="_blank" rel="noopener noreferrer" className={btnPrimary}>
            Web závodu ↗
          </a>
        )}
        {hasPoint && (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className={btnClass}
          >
            Navigovat ↗
          </a>
        )}
        {e.status !== "finished" && (
          <button type="button" className={btnClass} onClick={() => downloadIcs(e)}>
            Do kalendáře
          </button>
        )}
        <button type="button" className={btnClass} onClick={() => void share(e)}>
          Sdílet
        </button>
      </div>

      <dl className="mt-5 divide-y divide-border rounded-xl border border-border bg-surface px-4">
        <Row label="Termín">
          {formatDate(e.date_from)}
          {e.date_to && <> – {formatDate(e.date_to)}</>}
        </Row>
        <Row label="Disciplína">{DISCIPLINE_LABEL[e.discipline]}</Row>
        <Row label="Úroveň">{LEVEL_LABEL[e.level]}</Row>
        {e.series && <Row label="Seriál">{e.series}</Row>}
        <Row label="Místo">{e.location_name ?? <span className="text-muted">neuvedeno</span>}</Row>
        {e.region && <Row label="Kraj">{e.region}</Row>}
        {e.country !== "CZ" && <Row label="Země">{countryLabel(e.country)}</Row>}
        {e.organizer && <Row label="Pořadatel">{e.organizer}</Row>}
        {e.website_url && (
          <Row label="Web">
            <a href={e.website_url} target="_blank" rel="noopener noreferrer" className="text-pohar underline underline-offset-2">
              {hostOf(e.website_url)}
            </a>
          </Row>
        )}
        {e.description && <Row label="Poznámka">{e.description}</Row>}
      </dl>

      {hasPoint ? (
        <section className="mt-5" aria-label="Mapa">
          <Suspense fallback={<div className="h-56 rounded-xl border border-border bg-surface-2" />}>
            <EventMap events={[e]} single className="h-56 sm:h-72" />
          </Suspense>
          <p className="mt-1.5 text-xs text-muted">Poloha podle obce, ne přesné místo trati.</p>
        </section>
      ) : (
        <p className="mt-5 text-sm text-muted">Poloha závodu zatím není známá.</p>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Zdroje</h2>
        <ul className="mt-2 space-y-2">
          {e.sources.map((s) => (
            <li key={s.url + s.name} className="text-sm">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-pohar underline underline-offset-2">
                {s.name}
              </a>
              <span className="text-muted"> · naposledy ověřeno {formatTimestamp(s.last_seen_at)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">
          Údaje se stahují automaticky každý den. Aktuální informace vždy ověřte u pořadatele. Záznam změněn{" "}
          {formatTimestamp(e.updated_at)}.
        </p>
      </section>
    </article>
  );
}
