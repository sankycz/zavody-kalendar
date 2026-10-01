import { useEffect, useRef, type ReactNode } from "react";

/**
 * Glass panel sliding up from the bottom (on wider screens centered). Closes on
 * the backdrop, Escape or the close button; focus moves in and back out.
 */
export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="sheet-backdrop absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="sheet-panel glass-strong relative max-h-[85dvh] w-full overflow-y-auto rounded-t-[2rem] px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] outline-none sm:max-w-lg sm:rounded-[2rem] sm:pt-5"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted/40 sm:hidden" aria-hidden />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="press grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-muted hover:text-fg"
            aria-label="Zavřít"
          >
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
