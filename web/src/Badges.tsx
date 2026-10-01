import type { CSSProperties } from "react";
import type { Discipline } from "../../src/shared/types.ts";
import { DISCIPLINE_LABEL } from "./labels.ts";

/** One color per discipline: badge tint and, in dark mode, the card's glow. */
export const DISCIPLINE_COLOR: Record<Discipline, string> = {
  rally: "#ef4444",
  rallysprint: "#f97316",
  vrch: "#f59e0b",
  autocross: "#ca8a04",
  slalom: "#14b8a6",
  okruh: "#3b82f6",
  drift: "#a855f7",
  regularity: "#06b6d4",
  historic: "#a8a29e",
  jiny: "#64748b",
};

/** Small line icons (24×24, stroke). */
const ICON: Record<Discipline, string> = {
  rally: "M3 16.5 5.2 10a2 2 0 0 1 1.9-1.4h9.8a2 2 0 0 1 1.9 1.4L21 16.5M3 16.5h18v2.5H3zM7 19v1.5M17 19v1.5M6.5 13.5h.01M17.5 13.5h.01",
  rallysprint: "M13 2 4.5 13.5H11L10 22l8.5-11.5H12z",
  vrch: "m3 20 6.5-11 3.5 6 2.5-4L21 20z",
  autocross: "M2.5 16c2.4-3 4.8 3 7.2 0s4.8 3 7.2 0 3.6 1.5 4.6 0M2.5 10.5c2.4-3 4.8 3 7.2 0s4.8 3 7.2 0 3.6 1.5 4.6 0",
  slalom: "m6 20 2.5-10 2.5 10zM13.5 20l2-7.5 2 7.5zM4 20h16",
  okruh: "M7 6.5h8.5a3.75 3.75 0 0 1 0 7.5H9.5a2.75 2.75 0 0 0 0 5.5H18M7 6.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  drift: "M4 15.5C4 11 7.6 7 12 7s7.5 3 7.5 6.5S16.5 19 13.5 19s-4.5-2-4.5-4 1.6-3.2 3.2-3.2",
  regularity: "M12 9v4.5l2.8 1.8M9.5 2.5h5M12 5.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z",
  historic: "m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5l-5.3 2.9 1.2-6-4.5-4.1 6-.7z",
  jiny: "M5 21V4h11l-2 4 2 4H5",
};

export function DisciplineIcon({ d, className = "h-3.5 w-3.5" }: { d: Discipline; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICON[d]} />
    </svg>
  );
}

/** `--c` for components that tint themselves by discipline (badge, card glow). */
export function disciplineStyle(d: Discipline): CSSProperties {
  return { "--c": DISCIPLINE_COLOR[d] } as CSSProperties;
}

/** Glass pill: discipline icon + name, tinted with the discipline's color. */
export function DisciplineBadge({ d, onColor = false }: { d: Discipline; onColor?: boolean }) {
  return (
    <span
      style={disciplineStyle(d)}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold ${onColor ? "bg-white/20 text-white" : "badge-tint"}`}
    >
      <DisciplineIcon d={d} />
      {DISCIPLINE_LABEL[d]}
    </span>
  );
}
