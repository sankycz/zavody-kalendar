import { useEffect, useRef, useState } from "react";
import { EMPTY_FILTERS, listHref, type Filters } from "./filters.ts";
import { navigate } from "./router.ts";

export function SearchIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/** Magnifier in the header: opens the search bar (from a race detail it goes back to the list). */
export function SearchButton({ filters }: { filters: Filters | null }) {
  const open = filters?.q != null;
  return (
    <button
      type="button"
      aria-pressed={open}
      onClick={() => {
        if (!filters) return navigate(listHref({ ...EMPTY_FILTERS, q: "" }));
        navigate(listHref({ ...filters, q: open ? null : "" }), { replace: true });
      }}
      className={`press flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
        open ? "bg-racing text-white shadow-md shadow-accent/30" : "text-muted hover:bg-surface-2 hover:text-fg"
      }`}
      aria-label={open ? "Zavřít hledání" : "Hledat závod"}
      title="Hledat"
    >
      <SearchIcon />
    </button>
  );
}

/**
 * Full-text search over name, place, region, series and discipline. Typing
 * updates the URL (shareable) after a short pause; Esc or × closes the bar.
 */
export function SearchBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const [text, setText] = useState(filters.q ?? "");
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({ filters, onChange });
  latest.current = { filters, onChange };

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  // Back/forward or another change of the URL: show what it says.
  useEffect(() => {
    setText((t) => (t.trim() === (filters.q ?? "").trim() ? t : (filters.q ?? "")));
  }, [filters.q]);

  useEffect(() => {
    const { filters: f, onChange: change } = latest.current;
    if (text === (f.q ?? "")) return;
    const t = setTimeout(() => change({ ...latest.current.filters, q: text }), 250);
    return () => clearTimeout(t);
  }, [text]);

  const close = () => onChange({ ...filters, q: null });

  return (
    <div role="search" className="glass-strong flex items-center gap-2 rounded-2xl py-1.5 pr-1.5 pl-3.5">
      <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
      <input
        ref={input}
        type="search"
        value={text}
        onChange={(ev) => setText(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === "Escape") close();
        }}
        maxLength={100}
        enterKeyHint="search"
        placeholder="Hledat závod, obec, seriál…"
        aria-label="Hledat závod"
        className="min-h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
      />
      <button
        type="button"
        onClick={close}
        className="press grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg"
        aria-label="Zavřít hledání"
      >
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
