import type { ReactNode } from "react";
import type { View } from "./filters.ts";

function Item({ on, label, onClick, badge, busy, children }: { on: boolean; label: string; onClick: () => void; badge?: number; busy?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      disabled={busy}
      className={`press relative flex h-14 min-w-16 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[0.68rem] font-semibold transition-colors ${
        on ? "bg-racing text-white shadow-lg shadow-accent/35" : "text-muted hover:text-fg"
      } ${busy ? "opacity-60" : ""}`}
    >
      <svg viewBox="0 0 24 24" className={`h-5.5 w-5.5 ${busy ? "animate-pulse" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
      {label}
      {!!badge && (
        <span className="absolute top-1.5 right-3 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.6rem] leading-none font-bold text-accent-fg">
          {badge}
        </span>
      )}
    </button>
  );
}

/** Floating glass tab bar at the bottom of phones: view, near me and filters under the thumb. */
export function Dock({
  view,
  onView,
  near,
  nearBusy,
  onToggleNear,
  filterCount,
  onFilters,
}: {
  view: View;
  onView: (v: View) => void;
  near: boolean;
  nearBusy: boolean;
  onToggleNear: () => void;
  filterCount: number;
  onFilters: () => void;
}) {
  return (
    <nav
      aria-label="Ovládání"
      className="glass-strong fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 gap-1 rounded-full p-1.5 sm:hidden"
    >
      <Item on={view === "list"} label="Seznam" onClick={() => onView("list")}>
        <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
      </Item>
      <Item on={view === "map"} label="Mapa" onClick={() => onView("map")}>
        <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14" />
      </Item>
      <Item on={near} label="Blízko" onClick={onToggleNear} busy={nearBusy}>
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        <circle cx="12" cy="12" r="6.5" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
      </Item>
      <Item on={false} label="Filtry" onClick={onFilters} badge={filterCount}>
        <path d="M4 6h16M7 12h10M10 18h4" />
      </Item>
    </nav>
  );
}
