import { useState } from "react";
import { dateRange, formatTimestamp } from "./format.ts";
import { canSaveOffline, removeOffline, saveOffline, useInstall, useOfflineState, useOnline } from "./offline/client.ts";
import { isCurrent, todayInPrague } from "./offline/plan.ts";
import { Sheet } from "./Sheet.tsx";

const DISMISS_KEY = "install-dismissed";

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

const Icon = ({ d, className = "h-4.5 w-4.5" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const ICON_DOWNLOAD = "M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2";
const ICON_CHECK = "M20 6 9 17l-5-5";
const ICON_OFFLINE = "M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.17-2.8M19 13a10 10 0 0 0-2.2-1.6M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8A15 15 0 0 0 11 4.4M12 20h.01";
const ICON_SHARE = "M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7";

/** "Install the app" card on the list: one tap where the browser allows it, the steps on an iPhone. */
export function InstallCard() {
  const { mode, install } = useInstall();
  const [hidden, setHidden] = useState(dismissed);
  const [steps, setSteps] = useState(false);
  if (!mode || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* shows again next visit */
    }
  };

  return (
    <>
    <section aria-label="Instalace aplikace" className="glass-strong relative mb-4 flex items-start gap-3.5 rounded-2xl p-3.5 pr-10">
      <span aria-hidden className="bg-racing grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-md shadow-accent/30">
        <Icon d={ICON_DOWNLOAD} className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="leading-snug font-semibold">Kalendář do mobilu, i bez signálu</p>
        <p className="mt-0.5 text-sm text-muted">Závody víkendu, mapa okolí a harmonogramy se uloží samy. U trati v lese pak stačí otevřít.</p>
        <button
          type="button"
          onClick={() => (mode === "prompt" ? void install() : setSteps(true))}
          className="bg-racing press mt-2.5 min-h-10 rounded-xl px-4 text-sm font-bold text-white shadow-md shadow-accent/30"
        >
          {mode === "prompt" ? "Nainstalovat" : "Jak přidat na plochu"}
        </button>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Skrýt"
        className="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
      >
        <Icon d="M6 6l12 12M18 6 6 18" className="h-4 w-4" />
      </button>
    </section>
    {/* Outside the glass: backdrop-filter would make it the sheet's containing block. */}
    <Sheet open={steps} title="Přidat na plochu" onClose={() => setSteps(false)}>
        <ol className="space-y-3 text-sm">
          <li className="flex items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 font-bold">1</span>
            <span>
              V Safari ťukněte dole na <strong>Sdílet</strong>{" "}
              <Icon d={ICON_SHARE} className="inline h-4 w-4 align-[-2px] text-pohar" />
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 font-bold">2</span>
            <span>
              Vyberte <strong>Přidat na plochu</strong> a potvrďte <strong>Přidat</strong>.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 font-bold">3</span>
            <span>Aplikaci jednou otevřete s připojením, závody víkendu se uloží do telefonu.</span>
          </li>
        </ol>
        <button type="button" onClick={() => setSteps(false)} className="bg-racing press mt-6 min-h-12 w-full rounded-2xl font-bold text-white shadow-lg shadow-accent/30">
          Rozumím
        </button>
    </Sheet>
    </>
  );
}

/** Under the header when there's no connection: what the app shows comes from the phone. */
export function OfflineNotice() {
  const online = useOnline();
  const offline = useOfflineState();
  if (online) return null;
  const at = offline?.state.syncedAt;
  return (
    <p role="status" className="glass-strong mx-auto mt-2 flex w-fit max-w-3xl items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium">
      <Icon d={ICON_OFFLINE} className="h-4 w-4 text-accent" />
      Bez signálu{at ? ` · uložená data z ${formatTimestamp(at)}` : " · zobrazuji uložená data"}
    </p>
  );
}

/** Races kept on the phone (this weekend's automatically, others saved by hand). */
export function SavedRaces() {
  const offline = useOfflineState();
  const online = useOnline();
  if (!offline) return null;
  const today = todayInPrague();
  const races = Object.values(offline.state.races)
    .filter((r) => isCurrent(r, today))
    .sort((a, b) => a.date_from.localeCompare(b.date_from));
  if (races.length === 0) return null;
  return (
    <section aria-labelledby="saved-title" className={`glass mb-4 rounded-2xl p-3.5 ${online ? "" : "ring-2 ring-accent/40"}`}>
      <h2 id="saved-title" className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
        <Icon d={ICON_CHECK} className="h-3.5 w-3.5 text-regionalni" />
        V telefonu i bez signálu
      </h2>
      <ul className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
        {races.map((r) => (
          <li key={r.id} className="shrink-0">
            <a href={`/zavod/${r.id}`} className="press block max-w-56 rounded-xl bg-surface-2 px-3 py-2 ring-1 ring-glass-border ring-inset">
              <span className="block truncate text-sm font-semibold">{r.name}</span>
              <span className="block text-xs text-muted">
                {dateRange(r.date_from, r.date_to)}
                {r.docs.length > 0 && ` · ${r.docs.length} ${r.docs.length === 1 ? "dokument" : r.docs.length < 5 ? "dokumenty" : "dokumentů"}`}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Detail action: keep this race on the phone (or show that it is kept). */
export function SaveOfflineButton({ id, className }: { id: string; className: string }) {
  const offline = useOfflineState();
  const online = useOnline();
  if (!offline || !canSaveOffline()) return null;
  const saved = offline.state.races[id];
  const busy = offline.busy.includes(id);

  if (busy) {
    return (
      <button type="button" disabled className={`${className} opacity-70`}>
        <Icon d={ICON_DOWNLOAD} className="h-4 w-4 animate-pulse" />
        Ukládám…
      </button>
    );
  }
  if (saved) {
    const auto = !saved.pinned;
    return (
      <button
        type="button"
        onClick={auto ? undefined : () => removeOffline(id)}
        disabled={auto}
        title={auto ? "Závody nejbližšího víkendu se ukládají automaticky" : "Odebrat z telefonu"}
        aria-label={auto ? "Uloženo offline automaticky (závod tohoto víkendu)" : "Uloženo offline. Odebrat z telefonu."}
        className={`${className} text-regionalni`}
      >
        <Icon d={ICON_CHECK} className="h-4 w-4" />
        Offline
      </button>
    );
  }
  if (!online) return null;
  return (
    <button type="button" onClick={() => saveOffline(id)} className={className} title="Uložit závod, mapu okolí a dokumenty do telefonu">
      <Icon d={ICON_DOWNLOAD} className="h-4 w-4" />
      Uložit offline
    </button>
  );
}
