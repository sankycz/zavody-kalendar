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

/** GET a JSON endpoint; refetches when `url` changes, aborts stale requests. */
export function useJson<T>(url: string): Remote<T> {
  const [state, setState] = useState<Remote<T>>({ kind: "loading" });
  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => (s.kind === "ready" ? s : { kind: "loading" }));
    fetch(url, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new HttpError(res.status);
        setState({ kind: "ready", data: (await res.json()) as T });
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
