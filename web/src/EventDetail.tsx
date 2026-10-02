import { Suspense, lazy, useEffect } from "react";
import type { EventDetail as Detail, EventLink, LinkKind } from "../../src/shared/types.ts";
import { placeLabel, LEVEL_CLASS } from "./EventList.tsx";
import { formatDate, formatTimestamp, longDateRange, relativeDay } from "./format.ts";
import { googleCalendarUrl } from "../../src/shared/calendar.ts";
import { DisciplineBadge, disciplineStyle } from "./Badges.tsx";
import { DISCIPLINE_LABEL, LEVEL_LABEL, countryLabel } from "./labels.ts";
import { Countdown } from "./NextRace.tsx";
import { useNeighbours } from "./raceOrder.ts";
import { canGoBack, navigate } from "./router.ts";
import { FavoriteButton } from "./Favorite.tsx";
import { SaveOfflineButton } from "./Offline.tsx";
import { useOfflineState, useOnline } from "./offline/client.ts";
import { docUrl, todayInPrague } from "./offline/plan.ts";
import { liveParts, liveWindow } from "./live.ts";
import { RaceSteps, SwipeCard } from "./Swipe.tsx";
import { useJson } from "./useJson.ts";

const EventMap = lazy(() => import("./EventMap.tsx"));

const STATUS_LABEL = { planned: null, cancelled: "Zrušeno", finished: "Proběhlo" } as const;

function OrganizerBox({ e }: { e: Detail }) {
  const c = e.organizer_check;
  if (!c) return null;
  const changed = c.outcome === "changed";
  const title =
    c.status === "cancelled"
      ? "Pořadatel uvádí, že je závod zrušený"
      : c.status === "postponed"
        ? "Pořadatel uvádí, že je závod odložený"
        : c.date_from
          ? `Pořadatel uvádí jiný termín: ${formatDate(c.date_from)}${c.date_to ? ` – ${formatDate(c.date_to)}` : ""}`
          : c.outcome === "confirmed"
            ? "Web pořadatele termín potvrzuje"
            : c.outcome === "not_mentioned"
              ? "Na webu pořadatele o závodu zatím nic není"
              : "Web pořadatele se nepodařilo ověřit";
  return (
    <section
      aria-label="Web pořadatele"
      className={`mt-5 rounded-2xl p-4 ${changed ? "border border-accent/60 bg-accent/10 backdrop-blur" : "glass"}`}
    >
      <p className={`font-semibold ${changed ? "text-accent" : ""}`}>
        {!changed && c.outcome === "confirmed" && <span aria-hidden>✓ </span>}
        {title}
      </p>
      {c.notice && <p className="mt-1 text-sm">{c.notice}</p>}
      <p className="mt-2 text-xs text-muted">
        Automaticky ověřeno {formatTimestamp(c.checked_at)} na{" "}
        <a href={c.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          {hostOf(c.url)}
        </a>
        {c.error && " (poslední pokus se nezdařil, platí dřívější zjištění)"}. Rozhoduje vždy informace pořadatele.
      </p>
    </section>
  );
}

/** Line icons (24×24, stroke) per kind of document. */
const LINK_ICON: Record<LinkKind, string> = {
  harmonogram: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  mapa: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14",
  divaci: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm13 9v-1a4 4 0 0 0-3-3.87M16 4.13a3 3 0 0 1 0 5.74",
  propozice: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 13h8M8 17h5",
  plakat: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01",
  video: "m10 8 6 4-6 4V8ZM12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  jine: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1m2 5a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
};

/** Documents for spectators from the organizer: schedule, maps, regulations, poster. */
function LinksBox({ eventId, links }: { eventId: string; links: EventLink[] }) {
  const offline = useOfflineState();
  const online = useOnline();
  const saved = new Set(offline?.state.races[eventId]?.docs ?? []);
  if (links.length === 0) return null;
  return (
    <section aria-labelledby="links-title" className="glass mt-5 rounded-2xl p-4">
      <h2 id="links-title" className="text-sm font-semibold tracking-wide text-muted uppercase">
        Pro diváky
      </h2>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {links.map((l) => (
          <li key={l.url} className="flex">
            {/* Without a signal a stored document opens from the phone (our copy, src/docs.ts). */}
            <a
              href={!online && saved.has(l.url) ? docUrl(eventId, l.url) : l.url}
              {...(!online && saved.has(l.url) ? { "data-native": "" } : { target: "_blank", rel: "noopener noreferrer" })}
              className="press flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl bg-surface-2 px-3 py-2 ring-1 ring-glass-border transition-all ring-inset hover:brightness-110"
            >
              <span aria-hidden className="bg-racing grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white shadow-md shadow-accent/25">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={LINK_ICON[l.kind]} />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold first-letter:uppercase">{l.label}</span>
                <span className="block truncate text-xs text-muted">{hostOf(l.url)}</span>
              </span>
              <span aria-hidden className="text-muted">↗</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-2.5 sm:grid-cols-[10rem_1fr]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

const btnBase = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3.5 text-sm font-medium transition-all";
const btnClass = `${btnBase} glass press hover:brightness-110`;
const btnPrimary = `${btnBase} bg-racing press text-white shadow-lg shadow-accent/30 hover:brightness-110`;

/** iPhone, iPad, Mac: Apple Calendar first. */
const applePlatform = /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent);

function CalendarButtons({ e }: { e: Detail }) {
  const page = `${window.location.origin}/zavod/${e.id}`;
  const icon = (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 3v3M16 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM12 12v5M9.5 14.5h5" />
    </svg>
  );
  const google = (
    <a key="google" href={googleCalendarUrl(e, page)} target="_blank" rel="noopener noreferrer" className={btnClass} title="Otevře Google Kalendář s vyplněnou událostí">
      {icon}
      Google Kalendář
    </a>
  );
  // Served as text/calendar: iPhone shows "Add to Calendar", a Mac opens Calendar; no file to keep.
  const apple = (
    <a key="apple" href={`/api/events/${e.id}/ics`} target="_blank" rel="noopener" data-native className={btnClass} title="Přidá závod do Kalendáře na iPhonu nebo Macu">
      {icon}
      Apple Kalendář
    </a>
  );
  return <>{applePlatform ? [apple, google] : [google, apple]}</>;
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
  const { prev, next } = useNeighbours(id);
  const offlineState = useOfflineState();

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
        <div role="alert" className="glass mt-4 rounded-2xl p-4">
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
  const liveInfo = liveParts(e);
  const live = liveWindow(e, todayInPrague()) && liveInfo.length > 0;
  const savedOffline = !!offlineState?.state.races[e.id];

  return (
    <article className="pt-4">
      {back}
      <SwipeCard prev={prev} next={next}>

      <header
        style={{ ...disciplineStyle(e.discipline), viewTransitionName: `event-${e.id}` }}
        className="glass-strong card-glow relative mt-2 overflow-hidden rounded-3xl"
      >
        {/* The place on the map as the top of the card, fading into it. */}
        {hasPoint && (
          <div className="h-56 [mask-image:linear-gradient(to_bottom,black_55%,transparent)] sm:h-72">
            <Suspense fallback={<div className="h-full animate-pulse bg-surface-2" />}>
              <EventMap events={[e]} single framed={false} className="h-full w-full" />
            </Suspense>
          </div>
        )}
        <div className={`relative p-5 sm:p-6 ${hasPoint ? "-mt-10" : ""}`}>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <DisciplineBadge d={e.discipline} />
          <span className={`rounded-full px-2.5 py-0.5 font-medium ring-1 ring-inset ${LEVEL_CLASS[e.level]}`}>{LEVEL_LABEL[e.level]}</span>
          {status && (
            <span className={`rounded-full px-2.5 py-0.5 font-semibold ${e.status === "cancelled" ? "bg-racing text-white" : "bg-surface-2 text-muted"}`}>
              {status}
            </span>
          )}
        </div>
        <h1 className={`mt-3 text-2xl leading-tight font-extrabold tracking-tight sm:text-3xl ${e.status === "cancelled" ? "text-muted line-through" : ""}`}>{e.name}</h1>
        <p className="mt-1 text-base first-letter:uppercase">
          {longDateRange(e.date_from, e.date_to)}
          {soon && <span className="font-semibold text-accent"> · {soon}</span>}
        </p>
        {place && <p className="text-muted">{place}</p>}

        {e.status === "planned" && (
          <div className="mt-4">
            <Countdown date={e.date_from} glass />
          </div>
        )}

        {live && (
          <a
            href={`/zavod/${e.id}/zive`}
            className="bg-racing press shine mt-5 flex min-h-16 items-center gap-3.5 rounded-2xl px-5 py-2.5 text-white shadow-xl shadow-accent/35 hover:brightness-110"
          >
            <span className="live-dot" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-lg leading-tight font-extrabold">Živě ze závodu</span>
              <span className="block text-sm font-medium opacity-90 first-letter:uppercase">{liveInfo.join(" · ")}</span>
            </span>
            <span aria-hidden className="text-xl">→</span>
          </a>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
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
            <CalendarButtons e={e} />
          )}
          <FavoriteButton e={e} className={btnClass} />
          <button type="button" className={btnClass} onClick={() => void share(e)}>
            Sdílet
          </button>
          {e.status !== "finished" && !savedOffline && <SaveOfflineButton id={e.id} className={btnClass} />}
        </div>
        </div>
      </header>
      {hasPoint ? (
        <p className="mt-2 px-3 text-xs text-muted">Poloha podle obce, ne přesné místo trati.</p>
      ) : (
        <p className="mt-2 px-3 text-xs text-muted">Poloha závodu zatím není známá.</p>
      )}

      <LinksBox eventId={e.id} links={e.links ?? []} />

      <OrganizerBox e={e} />

      <dl className="glass mt-5 divide-y divide-border rounded-2xl px-4">
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
        {savedOffline && (
          <Row label="Bez signálu">Závod je uložený v telefonu: detail, mapu okolí i dokumenty si prohlédnete i bez signálu.</Row>
        )}
      </dl>

      <section className="glass mt-6 rounded-2xl p-4">
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
          Údaje se stahují automaticky každé pondělí. Aktuální informace vždy ověřte u pořadatele. Záznam změněn{" "}
          {formatTimestamp(e.updated_at)}.
        </p>
      </section>
      </SwipeCard>

      <RaceSteps prev={prev} next={next} />
    </article>
  );
}
