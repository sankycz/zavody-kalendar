import { useCallback, useEffect, useState } from "react";
import type { EventDetail } from "../../src/shared/types.ts";
import { Sheet } from "./Sheet.tsx";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "ready"; file: File; url: string }
  | { kind: "error" };

function fileName(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "zavod"}.png`;
}

/**
 * "Obrázek do Stories": draws the race as a picture (map, date, name, QR code),
 * shows it and offers the system share sheet (Instagram, Facebook…) or a download.
 * The share is a second tap on purpose: drawing the map takes a moment and
 * browsers allow sharing only right after a tap.
 */
export function ShareImageButton({ e, className }: { e: EventDetail; className: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const open = state.kind !== "idle";

  const close = useCallback(() => setState({ kind: "idle" }), []);

  useEffect(() => {
    if (state.kind !== "ready") return;
    return () => URL.revokeObjectURL(state.url);
  }, [state]);

  async function create() {
    setState({ kind: "busy" });
    try {
      const { createShareImage } = await import("./shareImage.ts");
      const page = `${location.origin}/zavod/${e.id}`;
      const blob = await createShareImage(
        { ...e, url: page, host: location.host.replace(/^www\./, "") },
        e.lat != null && e.lng != null ? { lat: e.lat, lng: e.lng } : null,
      );
      const file = new File([blob], fileName(e.name), { type: "image/png" });
      setState({ kind: "ready", file, url: URL.createObjectURL(blob) });
    } catch {
      setState({ kind: "error" });
    }
  }

  const canShare = state.kind === "ready" && !!navigator.canShare?.({ files: [state.file] });

  async function share() {
    if (state.kind !== "ready") return;
    try {
      await navigator.share({ files: [state.file], title: e.name });
    } catch {
      /* user cancelled */
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void create()}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="6" y="2.5" width="12" height="19" rx="3" />
          <path d="m9 15 2-2.5 1.5 1.5 2-3L16 15" />
        </svg>
        Obrázek do Stories
      </button>
      <Sheet open={open} title="Obrázek ke sdílení" onClose={close}>
        {state.kind === "busy" && (
          <div className="grid aspect-[9/16] max-h-[60dvh] w-full place-items-center rounded-2xl bg-surface-2 text-muted">
            Kreslím mapu…
          </div>
        )}
        {state.kind === "error" && <p className="py-6 text-center text-muted">Obrázek se nepodařilo vytvořit. Zkuste to znovu.</p>}
        {state.kind === "ready" && (
          <>
            <img
              src={state.url}
              alt={`Obrázek závodu ${e.name}`}
              className="mx-auto max-h-[60dvh] w-auto rounded-2xl shadow-xl"
            />
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {canShare && (
                <button type="button" className="bg-racing press min-h-11 rounded-full px-5 font-semibold text-white shadow-lg shadow-accent/30" onClick={() => void share()}>
                  Sdílet do Instagramu, Facebooku…
                </button>
              )}
              <a href={state.url} download={state.file.name} data-native className="glass press inline-flex min-h-11 items-center rounded-full px-5 font-semibold">
                Uložit obrázek
              </a>
            </div>
            {!canShare && <p className="mt-3 text-center text-sm text-muted">Obrázek uložte a nahrajte do příběhu na Instagramu nebo Facebooku.</p>}
          </>
        )}
      </Sheet>
    </>
  );
}
