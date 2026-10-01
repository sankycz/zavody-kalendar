import { useCallback, useState } from "react";
import type { Position } from "./distance.ts";

export type { Position } from "./distance.ts";

export type PositionState = "idle" | "asking" | "ok" | "denied" | "unavailable";

const KEY = "position";

function stored(): Position | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Position | null;
    return v && typeof v.lat === "number" && typeof v.lng === "number" ? v : null;
  } catch {
    return null;
  }
}

/**
 * The visitor's position, asked for only on request. Kept for this visit in
 * sessionStorage (rounded to ~1 km); never sent to the server or put in the URL.
 */
export function usePosition() {
  const [pos, setPos] = useState<Position | null>(stored);
  const [state, setState] = useState<PositionState>(pos ? "ok" : "idle");

  const request = useCallback((): Promise<Position | null> => {
    if (pos) return Promise.resolve(pos);
    if (!("geolocation" in navigator)) {
      setState("unavailable");
      return Promise.resolve(null);
    }
    setState("asking");
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const next = { lat: Math.round(p.coords.latitude * 100) / 100, lng: Math.round(p.coords.longitude * 100) / 100 };
          try {
            sessionStorage.setItem(KEY, JSON.stringify(next));
          } catch {
            /* storage unavailable: keep it in memory */
          }
          setPos(next);
          setState("ok");
          resolve(next);
        },
        (err) => {
          setState(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
          resolve(null);
        },
        { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
      );
    });
  }, [pos]);

  return { pos, state, request };
}
