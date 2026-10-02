import { Suspense, lazy, useEffect } from "react";
import type { EventDetail, LiveLink } from "../../src/shared/types.ts";
import { placeLabel } from "./EventList.tsx";
import { longDateRange } from "./format.ts";
import { forecastHours, forecastUrl, liveParts, liveWindow, weatherLabel, type Forecast } from "./live.ts";
import { todayInPrague } from "./offline/plan.ts";
import { useOnline } from "./offline/client.ts";
import { canGoBack, navigate } from "./router.ts";
import { useJson } from "./useJson.ts";

const RadarMap = lazy(() => import("./RadarMap.tsx"));

const hourFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
/** "2026-10-03T14:00", the format of Open-Meteo's hourly times. */
function nowHour(): string {
  return `${hourFmt.format(new Date()).replace(" ", "T")}:00`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Section({ title, icon, children, note }: { title: string; icon: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <section className="glass mt-4 rounded-2xl p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted uppercase">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={icon} />
        </svg>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
      {note && <p className="mt-3 text-xs text-muted">{note}</p>}
    </section>
  );
}

function LinkRow({ l, badge }: { l: Pick<LiveLink, "label" | "url">; badge?: string | undefined }) {
  return (
    <li>
      <a
        href={l.url}
        target="_blank"
        rel="noopener noreferrer"
        className="press flex min-h-12 items-center gap-3 rounded-xl bg-surface-2 px-3 py-2 ring-1 ring-glass-border ring-inset hover:brightness-110"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{l.label}</span>
          <span className="block truncate text-xs text-muted">{hostOf(l.url)}</span>
        </span>
        {badge && <span className="shrink-0 rounded-full bg-regionalni/15 px-2 py-0.5 text-[0.65rem] font-bold text-regionalni uppercase">{badge}</span>}
        <span aria-hidden className="text-muted">↗</span>
      </a>
    </li>
  );
}

function Weather({ e, mode }: { e: EventDetail; mode: "eve" | "live" }) {
  const state = useJson<Forecast>(forecastUrl(e.lat!, e.lng!));
  if (state.kind === "loading") return <div className="h-32 animate-pulse rounded-xl bg-surface-2" />;
  if (state.kind === "error") return <p className="text-sm text-muted">Předpověď se nepodařilo načíst{navigator.onLine ? "." : " (bez signálu a v telefonu uložená není)."}</p>;
  const f = state.data;
  const hours = forecastHours(f, mode, e.date_from, nowHour());
  const now = weatherLabel(f.current.weather_code);
  const wet = hours.filter((h) => (h.chance ?? 0) >= 50 || h.rain >= 0.5);
  return (
    <>
      {mode === "live" && (
        <div className="flex items-center gap-4">
          <span className="text-5xl leading-none" aria-hidden>
            {now.icon}
          </span>
          <div>
            <p className="text-3xl leading-none font-extrabold tabular-nums">{Math.round(f.current.temperature_2m)} °C</p>
            <p className="mt-1 text-sm text-muted">
              {now.text} · vítr {Math.round(f.current.wind_speed_10m)} km/h, nárazy {Math.round(f.current.wind_gusts_10m)} km/h
              {f.current.precipitation > 0 && ` · srážky ${f.current.precipitation} mm`}
            </p>
          </div>
        </div>
      )}
      <p className={`text-sm font-semibold ${mode === "live" ? "mt-4" : ""}`}>
        {mode === "eve" ? "Zítra během dne: " : "Dalších 12 hodin: "}
        <span className={wet.length ? "text-pohar" : "text-regionalni"}>
          {wet.length ? `déšť možný od ${wet[0]!.time.slice(11, 16)}` : "bez deště"}
        </span>
      </p>
      <ol className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Předpověď po hodinách">
        {hours.map((h) => (
          <li key={h.time} className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-surface-2 py-2 text-center">
            <span className="text-xs text-muted tabular-nums">{h.time.slice(11, 13)} h</span>
            <span className="mt-1 text-xl leading-none" aria-label={weatherLabel(h.code).text}>
              {weatherLabel(h.code).icon}
            </span>
            <span className="mt-1 text-sm font-semibold tabular-nums">{Math.round(h.temp)}°</span>
            <span className={`text-[0.7rem] tabular-nums ${(h.chance ?? 0) >= 50 ? "font-bold text-pohar" : "text-muted"}`}>
              {h.chance != null ? `${h.chance} %` : "–"}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted">
        Předpověď pro obec {e.location_name}, aktualizováno {f.current.time.slice(11, 16)}. Data{" "}
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          Open-Meteo.com
        </a>{" "}
        (CC BY 4.0).
      </p>
    </>
  );
}

/** "Živě ze závodu": weather and radar at the place, where to follow results and the stream. */
export function LivePage({ id }: { id: string }) {
  const state = useJson<EventDetail>(`/api/events/${id}`);
  const online = useOnline();

  useEffect(() => {
    if (state.kind === "ready") document.title = `Živě: ${state.data.name} – Závody aut v ČR`;
    return () => {
      document.title = "Závody aut v ČR";
    };
  }, [state]);

  const back = (
    <a
      href={`/zavod/${id}`}
      data-native
      onClick={(ev) => {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
        ev.preventDefault();
        if (canGoBack()) history.back();
        else navigate(`/zavod/${id}`);
      }}
      className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-muted hover:text-fg"
    >
      <span aria-hidden>←</span> Detail závodu
    </a>
  );

  if (state.kind === "loading") return <div className="pt-4">{back}<p className="py-10 text-center text-muted">Načítám…</p></div>;
  if (state.kind === "error") {
    return (
      <div className="pt-4">
        {back}
        <p role="alert" className="glass mt-4 rounded-2xl p-4 font-semibold">
          {state.status === 404 ? "Závod nebyl nalezen." : "Závod se nepodařilo načíst."}
        </p>
      </div>
    );
  }

  const e = state.data;
  const mode = liveWindow(e, todayInPrague());
  const live = e.live ?? { results: [], streams: [] };
  const hasPoint = e.lat != null && e.lng != null;

  return (
    <article className="pt-4">
      {back}
      <header className="bg-racing relative mt-2 overflow-hidden rounded-3xl p-5 text-white shadow-xl shadow-accent/25">
        <p className="flex items-center gap-2 text-xs font-bold tracking-widest uppercase">
          <span className="live-dot" aria-hidden />
          {mode === "live" ? "Živě · závod probíhá" : mode === "eve" ? "Zítra startuje" : "Živě ze závodu"}
        </p>
        <h1 className="mt-1.5 text-2xl leading-tight font-extrabold tracking-tight">{e.name}</h1>
        <p className="mt-1 text-sm opacity-90 first-letter:uppercase">
          {longDateRange(e.date_from, e.date_to)}
          {placeLabel(e) && <> · {placeLabel(e)}</>}
        </p>
      </header>
      {!mode && <p className="glass mt-4 rounded-2xl p-4 text-sm text-muted">Živý přehled je k dispozici den před závodem a během něj.</p>}
      {liveParts(e).length === 0 && (
        <p className="glass mt-4 rounded-2xl p-4 text-sm text-muted">
          K tomuto závodu zatím nemáme počasí, výsledky ani přenos. Odkazy pořadatele hledáme každé ráno, zkuste to později.
        </p>
      )}
      {!online && <p className="glass mt-4 rounded-2xl p-4 text-sm">Jste bez signálu: radar a odkazy potřebují připojení, předpověď je z poslední synchronizace.</p>}

      {hasPoint && (
        <Section title="Počasí na místě" icon="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z">
          <Weather e={e} mode={mode ?? "live"} />
        </Section>
      )}

      {hasPoint && online && (
        <Section
          title="Dešťový radar"
          icon="M12 2v4M12 12l6-6M4.93 4.93a10 10 0 1 0 14.14 0M8.46 8.46a5 5 0 1 0 7.08 0"
          note={<>Srážky za poslední dvě hodiny po 10 minutách. Tečka = obec závodu, trať může být v okolí.</>}
        >
          <Suspense fallback={<div className="h-72 animate-pulse rounded-2xl bg-surface-2" />}>
            <RadarMap lat={e.lat!} lng={e.lng!} />
          </Suspense>
        </Section>
      )}

      {live.results.length > 0 && (
        <Section
          title="Výsledky a live timing"
          icon="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"
          note="Výsledky vedou přímo pořadatelé a výsledkové servisy, my na ně jen odkazujeme."
        >
          <ul className="space-y-2">
            {live.results.map((l) => (
              <LinkRow key={l.url} l={l} badge={l.from === "organizer" ? "pořadatel" : undefined} />
            ))}
          </ul>
        </Section>
      )}

      {live.streams.length > 0 && (
        <Section title="Přenos" icon="M2 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8Zm16 2 4-2v8l-4-2">
          <ul className="space-y-2">
            {live.streams.map((l) => (
              <LinkRow key={l.url} l={l} badge={l.from === "organizer" ? "pořadatel" : undefined} />
            ))}
          </ul>
        </Section>
      )}
    </article>
  );
}
