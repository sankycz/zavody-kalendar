import { useEffect, useState, useSyncExternalStore } from "react";
import { getPrefs, subscribePrefs } from "../prefs.ts";
import { CACHES, EMPTY_STATE, STATE_KEY, type FromWorker, type OfflineState, type ToWorker } from "./plan.ts";

// Page side of the service worker (web/sw/sw.ts): registration, what is saved
// for use without a signal, and installing the app to the home screen.

const supported = typeof navigator !== "undefined" && "serviceWorker" in navigator;

function post(msg: ToWorker): void {
  if (!supported) return;
  void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage(msg));
}

/** Register the worker (production builds only) and keep the coming weekend's races saved. */
export function registerServiceWorker(): void {
  if (!supported || !import.meta.env.PROD) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then(async (reg) => {
        await navigator.serviceWorker.ready;
        post(syncMessage());
        // Chrome, installed app: refresh in the background twice a day (best effort).
        const periodic = (reg as ServiceWorkerRegistration & { periodicSync?: { register(tag: string, o: { minInterval: number }): Promise<void> } }).periodicSync;
        await periodic?.register("weekend-races", { minInterval: 12 * 3600_000 }).catch(() => {});
      })
      .catch((err: unknown) => console.warn("service worker:", err));
  });
  window.addEventListener("online", () => post(syncMessage()));
  // A new favourite on the coming weekend gets saved for offline use right away.
  let favorites = favoriteIds();
  subscribePrefs(() => {
    if (favoriteIds() === favorites) return;
    favorites = favoriteIds();
    post(syncMessage());
  });
}

function favoriteIds(): string {
  return Object.keys(getPrefs().favorites).sort().join();
}

function syncMessage(): ToWorker {
  return { type: "sync", favorites: Object.keys(getPrefs().favorites) };
}

export const saveOffline = (id: string) => post({ type: "save", id });
export const removeOffline = (id: string) => post({ type: "unsave", id });

// ---------- offline state ----------

interface Snapshot {
  state: OfflineState;
  /** Races being saved right now. */
  busy: string[];
}
let snapshot: Snapshot = { state: EMPTY_STATE, busy: [] };
const listeners = new Set<() => void>();

async function reload(busy = snapshot.busy): Promise<void> {
  let state = EMPTY_STATE;
  try {
    const res = await caches.match(STATE_KEY, { cacheName: CACHES.meta });
    if (res) state = (await res.json()) as OfflineState;
  } catch {
    /* no Cache API (private mode…): nothing saved */
  }
  snapshot = { state, busy };
  for (const l of listeners) l();
}

if (supported) {
  navigator.serviceWorker.addEventListener("message", (ev: MessageEvent<FromWorker>) => {
    if (ev.data?.type === "offline-state") void reload(ev.data.busy);
  });
  void reload();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** What the service worker keeps for offline use; null where it can't (no SW support). */
export function useOfflineState(): Snapshot | null {
  const s = useSyncExternalStore(subscribe, () => snapshot);
  return supported ? s : null;
}

/** Saving a race needs a service worker in control of the page. */
export function canSaveOffline(): boolean {
  return supported && !!navigator.serviceWorker.controller;
}

// ---------- connection ----------

function subscribeOnline(l: () => void) {
  window.addEventListener("online", l);
  window.addEventListener("offline", l);
  return () => {
    window.removeEventListener("online", l);
    window.removeEventListener("offline", l);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}

// ---------- install ----------

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
const notifyInstall = () => installListeners.forEach((l) => l());

if (typeof window !== "undefined") {
  // Chrome / Edge / Samsung: keep the browser's install prompt for our own button.
  window.addEventListener("beforeinstallprompt", (ev) => {
    ev.preventDefault();
    deferred = ev as BeforeInstallPromptEvent;
    notifyInstall();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notifyInstall();
  });
}

export function isStandalone(): boolean {
  return matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone / iPad Safari: no install prompt, "Share → Add to Home Screen" by hand. */
export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export interface Install {
  /** "prompt": one click; "ios": show the steps; null: installed already or not possible. */
  mode: "prompt" | "ios" | null;
  install: () => Promise<void>;
}

export function useInstall(): Install {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    installListeners.add(l);
    return () => void installListeners.delete(l);
  }, []);
  const mode = isStandalone() ? null : deferred ? "prompt" : isIos() ? "ios" : null;
  return {
    mode,
    install: async () => {
      const ev = deferred;
      if (!ev) return;
      await ev.prompt();
      await ev.userChoice.catch(() => null);
      deferred = null;
      notifyInstall();
    },
  };
}
