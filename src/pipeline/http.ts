import { isAllowed } from "./robots.ts";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface PoliteClientOptions {
  userAgent: string;
  /** Minimum gap between two requests to the same host. */
  minIntervalMs: number;
  fetcher?: Fetcher;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class RobotsDisallowedError extends Error {}

/**
 * HTTP client for scraping: own User-Agent, robots.txt check per host
 * (cached for the client's lifetime), and at most one request per
 * `minIntervalMs` per host.
 */
export class PoliteClient {
  private readonly lastRequest = new Map<string, number>();
  private readonly robots = new Map<string, string | null>();
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly opts: PoliteClientOptions;

  constructor(opts: PoliteClientOptions) {
    this.opts = opts;
    this.fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async throttle(host: string): Promise<void> {
    const last = this.lastRequest.get(host);
    if (last !== undefined) {
      const wait = last + this.opts.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastRequest.set(host, this.now());
  }

  private async rawGet(url: string): Promise<Response> {
    const host = new URL(url).host;
    await this.throttle(host);
    return this.fetcher(url, {
      headers: { "User-Agent": this.opts.userAgent, Accept: "*/*" },
      redirect: "follow",
    });
  }

  private async robotsFor(origin: string): Promise<string | null> {
    if (this.robots.has(origin)) return this.robots.get(origin)!;
    let txt: string | null = null;
    try {
      const res = await this.rawGet(`${origin}/robots.txt`);
      // 4xx = no restrictions (RFC 9309); 5xx / network error = treat as disallow-all.
      if (res.ok) txt = await res.text();
      else if (res.status >= 500) txt = "User-agent: *\nDisallow: /";
    } catch {
      txt = "User-agent: *\nDisallow: /";
    }
    this.robots.set(origin, txt);
    return txt;
  }

  async get(url: string): Promise<Response> {
    const u = new URL(url);
    const robotsTxt = await this.robotsFor(u.origin);
    if (robotsTxt && !isAllowed(robotsTxt, this.opts.userAgent, u.pathname + u.search)) {
      throw new RobotsDisallowedError(`robots.txt disallows ${url}`);
    }
    return this.rawGet(url);
  }
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
