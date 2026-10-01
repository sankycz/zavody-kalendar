import { useEffect, useRef, type ReactNode } from "react";
import type { RaceRef } from "./raceOrder.ts";
import { navigate } from "./router.ts";

/** Side the next card comes in from after a swipe (read once by the new detail). */
let entering: "next" | "prev" | null = null;
export function takeEntering(): "next" | "prev" | null {
  const e = entering;
  entering = null;
  return e;
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Go to a neighbouring race; replaces the entry so "back" still returns to the list. */
export function goToRace(r: RaceRef, dir: "next" | "prev") {
  entering = dir;
  navigate(`/zavod/${r.id}`, { replace: true, top: true });
}

/**
 * Tinder-like swipe on a phone: the card follows the finger (shift + tilt),
 * past a threshold it flies off and the next (swipe left) or previous (swipe
 * right) race comes in. Vertical scrolling stays the browser's (touch-action:
 * pan-y); the map and the screen edges (system back gesture) are left alone.
 */
export function SwipeCard({ prev, next, children }: { prev: RaceRef | null; next: RaceRef | null; children: ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  const hintPrev = useRef<HTMLDivElement>(null);
  const hintNext = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = card.current;
    if (!el) return;
    let start: { x: number; y: number; t: number; id: number } | null = null;
    let mode: "undecided" | "swipe" | "scroll" = "undecided";
    let dx = 0;
    let suppressClick = false;

    const hints = (offset: number) => {
      const p = Math.min(1, Math.abs(offset) / 120);
      if (hintNext.current) hintNext.current.style.opacity = offset < 0 && next ? String(p) : "0";
      if (hintPrev.current) hintPrev.current.style.opacity = offset > 0 && prev ? String(p) : "0";
    };
    const place = (offset: number) => {
      el.style.transform = offset ? `translateX(${offset}px) rotate(${offset / 22}deg)` : "";
      hints(offset);
    };
    const snapBack = () => {
      el.style.transition = "transform 380ms cubic-bezier(.2,.9,.3,1.25)";
      place(0);
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !e.isPrimary || (!prev && !next)) return;
      const t = e.target as Element;
      if (t.closest(".leaflet-container, input, select, textarea")) return;
      if (e.clientX < 24 || e.clientX > window.innerWidth - 24) return;
      start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      mode = "undecided";
      dx = 0;
    };
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const mx = e.clientX - start.x;
      const my = e.clientY - start.y;
      if (mode === "undecided") {
        if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
        mode = Math.abs(mx) > Math.abs(my) * 1.3 ? "swipe" : "scroll";
        if (mode === "scroll") return void (start = null);
        el.setPointerCapture(e.pointerId);
        el.style.transition = "none";
      }
      dx = mx;
      // No race that way: the card only gives a little (rubber band).
      place((dx < 0 ? next : prev) ? dx : dx * 0.2);
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const s = start;
      start = null;
      if (mode !== "swipe") return;
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 50);
      const target = dx < 0 ? next : prev;
      const speed = Math.abs(dx) / Math.max(1, performance.now() - s.t);
      if (!target || e.type === "pointercancel" || (Math.abs(dx) < window.innerWidth * 0.28 && speed < 0.5)) return snapBack();
      const dir = dx < 0 ? "next" : "prev";
      if (reducedMotion()) return goToRace(target, dir);
      const sign = dx < 0 ? -1 : 1;
      el.style.transition = "transform 260ms cubic-bezier(.4,0,1,1), opacity 260ms";
      el.style.transform = `translateX(${sign * window.innerWidth * 1.2}px) rotate(${sign * 18}deg)`;
      el.style.opacity = "0";
      hints(0);
      setTimeout(() => goToRace(target, dir), 200);
    };
    const click = (e: MouseEvent) => {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("click", click, true);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("click", click, true);
    };
  }, [prev, next]);

  // A card that came by a swipe enters from behind the stack (or from the side it was pulled from).
  const enter = useRef(takeEntering());

  return (
    <div className="relative">
      <div
        ref={hintPrev}
        aria-hidden
        className="glass-strong pointer-events-none fixed top-1/2 left-3 z-40 max-w-[45vw] -translate-y-1/2 rounded-2xl px-3 py-2 text-sm font-semibold opacity-0 transition-opacity"
      >
        <span className="block text-[0.65rem] tracking-wider text-muted uppercase">← Předchozí</span>
        <span className="line-clamp-2">{prev?.name}</span>
      </div>
      <div
        ref={hintNext}
        aria-hidden
        className="glass-strong pointer-events-none fixed top-1/2 right-3 z-40 max-w-[45vw] -translate-y-1/2 rounded-2xl px-3 py-2 text-right text-sm font-semibold opacity-0 transition-opacity"
      >
        <span className="block text-[0.65rem] tracking-wider text-muted uppercase">Další →</span>
        <span className="line-clamp-2">{next?.name}</span>
      </div>
      <div
        ref={card}
        className={`touch-pan-y will-change-transform ${enter.current ? `swipe-enter-${enter.current}` : ""}`}
        style={{ transformOrigin: "50% 100%" }}
      >
        {children}
      </div>
    </div>
  );
}

/** Previous / next race as buttons under the detail (also on desktop, and a hint that swiping works). */
export function RaceSteps({ prev, next }: { prev: RaceRef | null; next: RaceRef | null }) {
  if (!prev && !next) return null;
  const btn = "glass press flex min-h-14 min-w-0 flex-1 flex-col justify-center rounded-2xl px-3.5 py-2 hover:brightness-110";
  return (
    <nav aria-label="Další závody" className="mt-6 flex gap-2">
      {prev ? (
        <button type="button" className={`${btn} items-start text-left`} onClick={() => goToRace(prev, "prev")}>
          <span className="text-[0.65rem] font-semibold tracking-wider text-muted uppercase">← Předchozí</span>
          <span className="w-full truncate text-sm font-semibold">{prev.name}</span>
        </button>
      ) : (
        <span className="flex-1" />
      )}
      {next ? (
        <button type="button" className={`${btn} items-end text-right`} onClick={() => goToRace(next, "next")}>
          <span className="text-[0.65rem] font-semibold tracking-wider text-muted uppercase">Další →</span>
          <span className="w-full truncate text-sm font-semibold">{next.name}</span>
        </button>
      ) : (
        <span className="flex-1" />
      )}
    </nav>
  );
}
