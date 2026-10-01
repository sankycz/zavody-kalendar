import { useEffect, useState } from "react";

export type Remote<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string; status?: number }
  | { kind: "ready"; data: T };

class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Server vrátil ${status}`);
    this.status = status;
  }
}

/**
 * Last responses of this visit: going back to the list (or swiping to a
 * prefetched race) renders at once from here, then refreshes in the background.
 */
const cache = new Map<string, unknown>();
const MAX_CACHED = 60;

function remember(url: string, data: unknown) {
  cache.delete(url);
  cache.set(url, data);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, signal ? { signal } : {});
  if (!res.ok) throw new HttpError(res.status);
  const data: unknown = await res.json();
  remember(url, data);
  return data;
}

/** Load a response ahead (e.g. the neighbouring races of a detail). */
export function prefetchJson(url: string): void {
  if (!cache.has(url)) getJson(url).catch(() => {});
}

/** Cached response of this visit, if any. */
export function cachedJson<T>(url: string): T | undefined {
  return cache.get(url) as T | undefined;
}

/** GET a JSON endpoint; refetches when `url` changes, aborts stale requests. */
export function useJson<T>(url: string): Remote<T> {
  const [state, setState] = useState<Remote<T>>(() =>
    cache.has(url) ? { kind: "ready", data: cache.get(url) as T } : { kind: "loading" },
  );
  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => (cache.has(url) ? { kind: "ready", data: cache.get(url) as T } : s.kind === "ready" ? s : { kind: "loading" }));
    getJson(url, ctrl.signal)
      .then((data) => {
        setState({ kind: "ready", data: data as T });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
          ...(err instanceof HttpError ? { status: err.status } : {}),
        });
      });
    return () => ctrl.abort();
  }, [url]);
  return state;
}
