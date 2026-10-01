import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { EventListItem } from "../../src/shared/types.ts";
import { DisciplineBadge, disciplineStyle } from "./Badges.tsx";
import { formatDistance, type Position } from "./distance.ts";
import { placeLabel } from "./EventList.tsx";
import { dateRange, dayNumber, monthShort, relativeDay } from "./format.ts";

const EventMap = lazy(() => import("./EventMap.tsx"));

function useIsWide(): boolean {
  const q = "(min-width: 40rem)";
  const [wide, setWide] = useState(() => typeof matchMedia === "function" && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

function MapCard({ e, selected, km }: { e: EventListItem; selected: boolean; km: number | undefined }) {
  const soon = e.status === "planned" ? relativeDay(e.date_from, e.date_to) : null;
  return (
    <a
      href={`/zavod/${e.id}`}
      data-id={e.id}
      style={{ ...disciplineStyle(e.discipline), viewTransitionName: `event-${e.id}` }}
      className={`glass-strong card-glow press flex w-[80vw] max-w-[21rem] shrink-0 snap-center gap-3 rounded-3xl p-3.5 transition-transform duration-300 ${
        selected ? "scale-100" : "scale-[0.94] opacity-85"
      } ${e.status === "cancelled" || e.status === "finished" ? "grayscale-[0.6]" : ""}`}
    >
      <div className="bg-racing flex w-13 shrink-0 flex-col items-center justify-center rounded-2xl py-2 text-white shadow-lg shadow-accent/30">
        <span className="text-xl leading-none font-extrabold tabular-nums">{dayNumber(e.date_from)}</span>
        <span className="mt-0.5 text-[0.65rem] font-semibold uppercase opacity-90">{monthShort(e.date_from)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className={`truncate font-bold ${e.status === "cancelled" ? "line-through" : ""}`}>{e.name}</h3>
        <p className="mt-0.5 truncate text-sm text-muted">
          {dateRange(e.date_from, e.date_to)} · {placeLabel(e)}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          <DisciplineBadge d={e.discipline} />
          {km !== undefined && <span className="font-bold text-[#0284c7] dark:text-[#38bdf8]">{formatDistance(km)}</span>}
          {soon && <span className="font-semibold text-accent">{soon}</span>}
          {e.status === "cancelled" && <span className="font-semibold text-accent">Zrušeno</span>}
        </div>
      </div>
    </a>
  );
}

/**
 * Edge-to-edge map with floating glass UI: `top` controls under the header,
 * a strip of race cards at the bottom. Tapping a marker scrolls the strip to its
 * race; scrolling the strip flies the map to the race in the middle.
 */
export function MapView({
  events,
  me,
  distances,
  top,
}: {
  events: EventListItem[];
  me: Position | null;
  distances: Map<string, number> | undefined;
  top: ReactNode;
}) {
  const wide = useIsWide();
  const located = useMemo(() => events.filter((e) => e.lat != null && e.lng != null), [events]);
  // `fly`: chosen by the visitor (marker or strip) – the map follows; the initial pick only highlights.
  const [pick, setPick] = useState<{ id: string | null; fly: boolean }>({ id: null, fly: false });
  const selected = pick.id;
  const strip = useRef<HTMLDivElement>(null);
  const fromMap = useRef(false);

  // Start at the first race of the list (the next one, or the nearest).
  useEffect(() => {
    setPick((p) => (p.id && located.some((e) => e.id === p.id) ? p : { id: located[0]?.id ?? null, fly: false }));
  }, [located]);

  const onMarker = useCallback((id: string) => {
    fromMap.current = true;
    setPick({ id, fly: true });
    strip.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, []);

  // Strip scrolled by hand: the card in the middle is the selected race.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (fromMap.current) {
        fromMap.current = false;
        return;
      }
      const mid = el.getBoundingClientRect().left + el.clientWidth / 2;
      let best: { id: string; d: number } | null = null;
      for (const c of el.querySelectorAll<HTMLElement>("[data-id]")) {
        const r = c.getBoundingClientRect();
        const d = Math.abs(r.left + r.width / 2 - mid);
        if (!best || d < best.d) best = { id: c.dataset.id!, d };
      }
      if (best) setPick((p) => (p.id === best.id ? p : { id: best.id, fly: true }));
    };
    const onScroll = () => {
      clearTimeout(t);
      t = setTimeout(settle, 140);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      clearTimeout(t);
    };
  }, []);

  // Floating UI over the map: header + controls on top, card strip (+ dock on phones) at the bottom.
  const padding = useMemo(() => ({ top: wide ? 168 : 150, bottom: wide ? 190 : 250 }), [wide]);

  return (
    <div className="fixed inset-0 z-10">
      <Suspense fallback={<div className="h-full w-full animate-pulse bg-surface-2" />}>
        <EventMap events={located} me={me} selectedId={selected} follow={pick.fly} onSelect={onMarker} fullscreen padding={padding} className="h-full w-full" />
      </Suspense>

      <div className="pointer-events-none absolute inset-x-0 top-[calc(max(0.75rem,env(safe-area-inset-top))+4.25rem)] z-20 px-3">
        <div className="pointer-events-auto mx-auto flex max-w-3xl flex-col gap-2">{top}</div>
      </div>

      <div className="absolute inset-x-0 bottom-[max(6.25rem,calc(env(safe-area-inset-bottom)+5.75rem))] z-20 sm:bottom-6">
        {located.length === 0 ? (
          <p className="glass-strong mx-auto w-fit rounded-full px-4 py-2 text-sm text-muted">Žádný závod se známou polohou.</p>
        ) : (
          <div
            ref={strip}
            className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto scroll-smooth px-[10vw] pb-1 [scrollbar-width:none] sm:px-[calc(50vw-10.5rem)] [&::-webkit-scrollbar]:hidden"
            aria-label="Závody na mapě"
          >
            {located.map((e) => (
              <MapCard key={e.id} e={e} selected={e.id === selected} km={distances?.get(e.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
