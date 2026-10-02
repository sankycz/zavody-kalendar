import type { EventListItem } from "../../src/shared/types.ts";
import { toggleFavorite, usePrefs } from "./prefs.ts";

const STAR = "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z";

export function StarIcon({ on, className = "h-5 w-5" }: { on: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d={STAR} />
    </svg>
  );
}

type Race = Pick<EventListItem, "id" | "name" | "date_from" | "date_to">;

/** Star on a list card: favourite or not, kept in this browser only. */
export function FavoriteStar({ e, className = "" }: { e: Race; className?: string }) {
  const on = !!usePrefs().favorites[e.id];
  return (
    <button
      type="button"
      onClick={() => toggleFavorite(e)}
      aria-pressed={on}
      aria-label={on ? `Odebrat ${e.name} z oblíbených` : `Přidat ${e.name} do oblíbených`}
      className={`press grid h-10 w-10 place-items-center rounded-full transition-colors ${on ? "text-[#f5a524]" : "text-muted hover:bg-surface-2 hover:text-fg"} ${className}`}
    >
      <StarIcon on={on} />
    </button>
  );
}

/** Detail action: "Do oblíbených" / "V oblíbených". */
export function FavoriteButton({ e, className }: { e: Race; className: string }) {
  const on = !!usePrefs().favorites[e.id];
  return (
    <button type="button" onClick={() => toggleFavorite(e)} aria-pressed={on} className={`${className} ${on ? "text-[#d48806] dark:text-[#f5a524]" : ""}`}>
      <StarIcon on={on} className="h-4 w-4" />
      {on ? "V oblíbených" : "Do oblíbených"}
    </button>
  );
}
