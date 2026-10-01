import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

// Minimal history-based router: "/" = list (filters in the query string), "/zavod/<id>" = detail.

const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}
/**
 * Page changes run inside a View Transition where the browser has it: the list
 * card and the detail header share a view-transition-name, so one morphs into
 * the other. Filter changes (replace) just update.
 */
function transition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches) return update();
  doc.startViewTransition(() => flushSync(update));
}

window.addEventListener("popstate", () => transition(notify));

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function snapshot(): string {
  return window.location.pathname + window.location.search;
}

/** Current path + query; re-renders on navigation. */
export function useLocation(): URL {
  const href = useSyncExternalStore(subscribe, snapshot);
  return new URL(href, window.location.origin);
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === snapshot()) return;
  if (opts.replace) {
    window.history.replaceState(null, "", to);
    return notify();
  }
  transition(() => {
    window.history.pushState({ inApp: true }, "", to);
    window.scrollTo(0, 0);
    notify();
  });
}

/** True when the previous history entry is ours (so "back" stays in the app). */
export function canGoBack(): boolean {
  return (window.history.state as { inApp?: boolean } | null)?.inApp === true;
}

// Intercept clicks on same-origin links (capture phase, so Leaflet popups that
// stop propagation still work). Modifier clicks keep the browser default;
// links with `data-native` handle their own clicks.
document.addEventListener(
  "click",
  (ev) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const a = (ev.target as Element | null)?.closest?.("a");
    if (!a || a.target || a.hasAttribute("download") || a.hasAttribute("data-native")) return;
    const url = new URL(a.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
    ev.preventDefault();
    navigate(url.pathname + url.search);
  },
  true,
);
