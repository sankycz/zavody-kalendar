import { useEffect, useState } from "react";

const KEY = "intro-seen";
/** Total length; the CSS timeline in index.css (.intro-*) matches it. */
const DURATION_MS = 4000;
const REDUCED_MS = 900;

function seen(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Start-lights intro on app launch (once per visit): five red lights come on
 * one by one, go out – lights out, away we go – and the logo appears. Tap,
 * click or any key skips it. With reduced motion only the logo, briefly.
 */
export function Intro() {
  const [show, setShow] = useState(() => !seen());
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!show) return;
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* storage unavailable: it just plays again next time */
    }
    const done = () => setShow(false);
    const t = setTimeout(done, reduced ? REDUCED_MS : DURATION_MS);
    window.addEventListener("keydown", done);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", done);
    };
  }, [show, reduced]);

  if (!show) return null;
  return (
    <div
      className={`intro fixed inset-0 z-[100] grid cursor-pointer place-items-center ${reduced ? "intro--reduced" : ""}`}
      onClick={() => setShow(false)}
      role="presentation"
    >
      <div className="flex flex-col items-center px-6 text-center">
        {!reduced && (
          <div className="intro-gantry flex gap-2.5 rounded-2xl p-3 sm:gap-3.5 sm:p-4" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex flex-col gap-2 rounded-xl bg-black/60 p-1.5 sm:p-2">
                <span className="intro-light" style={{ animationDelay: `${0.5 + i * 0.4}s, 2.7s` }} />
                <span className="intro-light" style={{ animationDelay: `${0.5 + i * 0.4}s, 2.7s` }} />
              </div>
            ))}
          </div>
        )}
        <div className="intro-logo mt-8 flex flex-col items-center">
          <span className="bg-racing grid h-16 w-16 place-items-center rounded-2xl shadow-xl shadow-accent/40">
            <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
            </svg>
          </span>
          <p className="mt-4 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Závody aut <span className="text-racing">v Česku</span>
          </p>
          <p className="mt-1.5 text-sm text-white/70">Rally · vrchy · okruhy · autokros · slalom</p>
        </div>
      </div>
      <span className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] text-xs text-white/40">Klepnutím přeskočíte</span>
    </div>
  );
}
