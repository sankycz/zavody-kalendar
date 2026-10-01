import { useEffect, useState } from "react";
import type { EventListItem } from "../../src/shared/types.ts";
import { placeLabel } from "./EventList.tsx";
import { longDateRange } from "./format.ts";
import { DisciplineBadge } from "./Badges.tsx";
import { LEVEL_LABEL } from "./labels.ts";

function startOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getTime();
}

/** The race in progress, else the next one (cancelled ones skipped). */
export function nextRace(events: EventListItem[], now = Date.now()): EventListItem | null {
  return (
    events.find((e) => e.status === "planned" && !e.organizer_flag && startOf(e.date_to ?? e.date_from) + 86_400_000 > now) ?? null
  );
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function Unit({ value, label, glass }: { value: number; label: string; glass: boolean }) {
  return (
    <div className={`min-w-14 rounded-xl px-2 py-1.5 text-center backdrop-blur ${glass ? "bg-surface-2 ring-1 ring-glass-border ring-inset" : "bg-white/15"}`}>
      <div className="text-2xl leading-none font-extrabold tabular-nums">{value}</div>
      <div className="mt-1 text-[0.65rem] font-semibold tracking-wider uppercase opacity-85">{label}</div>
    </div>
  );
}

const plural = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

/** Live countdown to the first day of a race; null once it started. */
export function Countdown({ date, glass = false }: { date: string; glass?: boolean }) {
  const now = useNow(1000);
  const left = startOf(date) - now;
  if (left <= 0) return null;
  const d = Math.floor(left / 86_400_000);
  const h = Math.floor((left % 86_400_000) / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <div className="flex gap-2" role="timer" aria-label={`Start za ${d} ${plural(d, "den", "dny", "dní")} a ${h} h`}>
      <Unit glass={glass} value={d} label={plural(d, "den", "dny", "dní")} />
      <Unit glass={glass} value={h} label="hod" />
      <Unit glass={glass} value={m} label="min" />
      <Unit glass={glass} value={s} label="s" />
    </div>
  );
}

/** Highlighted card of the next race with a live countdown to its first day. */
export function NextRace({ event }: { event: EventListItem }) {
  const now = useNow(60_000);
  const running = startOf(event.date_from) <= now;
  const place = placeLabel(event);

  return (
    <a
      href={`/zavod/${event.id}`}
      className="bg-racing press shine group relative mb-5 block overflow-hidden rounded-3xl p-5 text-white shadow-xl shadow-accent/25 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:p-6"
    >
      {/* Checkered strip, a nod to the finish flag. */}
      <div
        aria-hidden
        className="absolute inset-y-0 right-0 w-24 opacity-15 sm:w-36"
        style={{
          backgroundImage:
            "conic-gradient(#fff 25%, transparent 0 50%, #fff 0 75%, transparent 0)",
          backgroundSize: "24px 24px",
          maskImage: "linear-gradient(to left, black, transparent)",
          WebkitMaskImage: "linear-gradient(to left, black, transparent)",
        }}
      />
      <div className="relative">
        <p className="text-xs font-bold tracking-widest uppercase opacity-90">{running ? "Právě probíhá" : "Nejbližší závod"}</p>
        <h2 className="mt-1.5 text-2xl leading-tight font-extrabold tracking-tight sm:text-3xl">{event.name}</h2>
        <p className="mt-1 text-sm opacity-90 first-letter:uppercase">
          {longDateRange(event.date_from, event.date_to)}
          {place && <> · {place}</>}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
          <DisciplineBadge d={event.discipline} onColor />
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 font-semibold">{LEVEL_LABEL[event.level]}</span>
        </div>
        <div className="mt-4">
          <Countdown date={event.date_from} />
        </div>
      </div>
    </a>
  );
}
