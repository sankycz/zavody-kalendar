import { useState } from "react";
import type { RegionsResponse } from "../../src/shared/types.ts";
import { DISCIPLINES, EMPTY_FILTERS, LEVELS, activeFilterCount, type Filters } from "./filters.ts";
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
      className={`min-h-9 rounded-full border px-3 text-sm font-medium transition-colors ${
        on ? "border-fg bg-fg text-bg" : "border-border bg-surface text-fg hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}

const fieldClass =
  "min-h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg focus:outline-2 focus:outline-accent";

export function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const [open, setOpen] = useState(false);
  const regions = useJson<RegionsResponse>("/api/regions");
  const count = activeFilterCount(filters);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const regionOptions = regions.kind === "ready" ? regions.data.regions : [];

  return (
    <div className="border-b border-border pb-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="filters"
          onClick={() => setOpen(!open)}
          className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold"
        >
          <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 fill-current">
            <path d="M2 4h16v2H2zm3 5h10v2H5zm3 5h4v2H8z" />
          </svg>
          Filtry
          {count > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-xs leading-5 font-bold text-accent-fg">{count}</span>
          )}
        </button>

        <div role="group" aria-label="Zobrazení" className="ml-auto flex rounded-lg border border-border bg-surface p-0.5">
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={filters.view === v}
              onClick={() => set({ view: v })}
              className={`min-h-9 rounded-md px-3 text-sm font-medium ${
                filters.view === v ? "bg-fg text-bg" : "text-muted hover:text-fg"
              }`}
            >
              {v === "list" ? "Seznam" : "Mapa"}
            </button>
          ))}
        </div>
      </div>

      {open && (
        <div id="filters" className="mt-3 space-y-4">
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
              onClick={() => onChange({ ...EMPTY_FILTERS, view: filters.view })}
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
