import { useState } from "react";
import type { RegionsResponse } from "../../src/shared/types.ts";
import { DISCIPLINES, EMPTY_FILTERS, LEVELS, activeFilterCount, seasonOf, type Filters } from "./filters.ts";
import { DISCIPLINE_LABEL, LEVEL_LABEL } from "./labels.ts";
import { useJson } from "./useJson.ts";

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-9 rounded-full border px-3.5 text-sm font-medium transition-all ${
        on
          ? "border-transparent bg-racing text-white shadow-md shadow-accent/25"
          : "border-glass-border bg-glass text-fg backdrop-blur hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}

const fieldClass =
  "min-h-10 w-full rounded-xl border border-glass-border bg-glass-strong px-3 text-sm text-fg backdrop-blur focus:outline-2 focus:outline-accent";

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  /** Sorted by distance from the visitor. */
  near: boolean;
  /** Waiting for the browser's position. */
  nearBusy: boolean;
  onToggleNear: () => void;
}

export function FilterBar({ filters, onChange, near, nearBusy, onToggleNear }: Props) {
  const [open, setOpen] = useState(false);
  const regions = useJson<RegionsResponse>("/api/regions");
  const count = activeFilterCount(filters);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const regionOptions = regions.kind === "ready" ? regions.data.regions : [];

  return (
    <div className="glass rounded-2xl p-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="filters"
          onClick={() => setOpen(!open)}
          className={`flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors hover:bg-surface-2 ${open ? "bg-surface-2" : ""}`}
        >
          <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 fill-current">
            <path d="M2 4h16v2H2zm3 5h10v2H5zm3 5h4v2H8z" />
          </svg>
          Filtry
          {count > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-xs leading-5 font-bold text-accent-fg">{count}</span>
          )}
        </button>

        <button
          type="button"
          aria-pressed={near}
          onClick={onToggleNear}
          disabled={nearBusy}
          className={`flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-colors ${
            near ? "bg-racing text-white shadow-md shadow-accent/25" : "hover:bg-surface-2"
          } ${nearBusy ? "opacity-60" : ""}`}
          title="Seřadit podle vzdálenosti od vás"
        >
          <svg aria-hidden viewBox="0 0 24 24" className={`h-4 w-4 ${nearBusy ? "animate-pulse" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            <circle cx="12" cy="12" r="6.5" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
          </svg>
          <span className="hidden sm:inline">Blízko mě</span>
          <span className="sm:hidden">Blízko</span>
        </button>

        <div role="group" aria-label="Zobrazení" className="ml-auto flex rounded-xl bg-surface-2 p-1">
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={filters.view === v}
              onClick={() => set({ view: v })}
              className={`flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-all ${
                filters.view === v ? "glass-strong text-fg" : "border border-transparent text-muted hover:text-fg"
              }`}
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {v === "list" ? <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /> : <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14" />}
              </svg>
              <span className="sr-only sm:not-sr-only">{v === "list" ? "Seznam" : "Mapa"}</span>
            </button>
          ))}
        </div>
      </div>

      {open && (
        <div id="filters" className="space-y-4 px-2 pt-3 pb-2">
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Disciplína</legend>
            <div className="flex flex-wrap gap-1.5">
              {DISCIPLINES.map((d) => (
                <Chip key={d} on={filters.discipline.includes(d)} onClick={() => set({ discipline: toggle(filters.discipline, d) })}>
                  {DISCIPLINE_LABEL[d]}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Úroveň</legend>
            <div className="flex flex-wrap gap-1.5">
              {LEVELS.map((l) => (
                <Chip key={l} on={filters.level.includes(l)} onClick={() => set({ level: toggle(filters.level, l) })}>
                  {LEVEL_LABEL[l]}
                </Chip>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="col-span-2 block sm:col-span-1">
              <span className="mb-1.5 block text-xs font-semibold tracking-wide text-muted uppercase">Kraj</span>
              <select className={fieldClass} value={filters.region} onChange={(e) => set({ region: e.target.value })}>
                <option value="">Všechny kraje</option>
                {filters.region && !regionOptions.includes(filters.region) && (
                  <option value={filters.region}>{filters.region}</option>
                )}
                {regionOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold tracking-wide text-muted uppercase">Od</span>
              <input type="date" className={fieldClass} value={filters.from} onChange={(e) => set({ from: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold tracking-wide text-muted uppercase">Do</span>
              <input
                type="date"
                className={fieldClass}
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) => set({ to: e.target.value })}
              />
            </label>
          </div>

          {count > 0 && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...EMPTY_FILTERS,
                  view: filters.view,
                  sort: filters.sort,
                  // The season switch above isn't a filter: keep it.
                  ...(seasonOf(filters) !== null ? { from: filters.from, to: filters.to } : {}),
                })
              }
              className="text-sm font-medium text-accent underline-offset-2 hover:underline"
            >
              Zrušit všechny filtry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
