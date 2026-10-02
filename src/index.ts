import Anthropic from "@anthropic-ai/sdk";
import { handleApi, pragueHour, todayInPrague } from "./api.ts";
import { handleDoc } from "./docs.ts";
import { apifyEvents } from "./pipeline/facebook.ts";
import { backfillCoordinates } from "./pipeline/geocode.ts";
import { PoliteClient } from "./pipeline/http.ts";
import { rollover } from "./pipeline/rollover.ts";
import { claudeModel, workersAiModel, type AiBinding, type JsonModel } from "./pipeline/llm.ts";
import { checkOrganizers, DEFAULT_CHECK_LIMIT } from "./pipeline/organizer.ts";
import { markFinished, runAll, type RunDeps } from "./pipeline/run.ts";
import { mergeEvents } from "./pipeline/upsert.ts";

export interface Env {
  DB: D1Database;
  /** Workers AI binding (used when EXTRACTOR = "workers-ai"). */
  AI: Ai;
  /** "workers-ai" (free daily allocation) or "claude" (Claude API, needs ANTHROPIC_API_KEY). */
  EXTRACTOR: string;
  WORKERS_AI_MODEL: string;
  ANTHROPIC_API_KEY?: string;
  ADMIN_TOKEN: string;
  CLAUDE_MODEL: string;
  CONTACT_EMAIL: string;
  /** Apify API token for Facebook sources (secret); without it they fail with an error. */
  APIFY_TOKEN?: string;
  /** Max Facebook events per source and run (pay per event, default 50). */
  APIFY_MAX_EVENTS?: string;
  /** Max organizer websites checked per run (default 10). */
  ORGANIZER_CHECK_LIMIT?: string;
}

/** Local (Prague) hour of the weekly run, see the crons in wrangler.jsonc. */
const INGEST_HOUR = 5;

function maxEvents(env: Env): number {
  const n = Number(env.APIFY_MAX_EVENTS ?? 50);
  return Number.isInteger(n) && n > 0 && n <= 500 ? n : 50;
}

function checkLimit(env: Env, override?: string | null): number {
  const n = Number(override ?? env.ORGANIZER_CHECK_LIMIT ?? DEFAULT_CHECK_LIMIT);
  return Number.isInteger(n) && n >= 0 && n <= 50 ? n : DEFAULT_CHECK_LIMIT;
}

function llm(env: Env): JsonModel {
  if (env.EXTRACTOR === "claude") {
    if (!env.CLAUDE_MODEL) throw new Error("CLAUDE_MODEL is not set");
    if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
    return claudeModel(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), env.CLAUDE_MODEL);
  }
  if (env.EXTRACTOR === "workers-ai") {
    if (!env.WORKERS_AI_MODEL) throw new Error("WORKERS_AI_MODEL is not set");
    return workersAiModel(env.AI as unknown as AiBinding, env.WORKERS_AI_MODEL);
  }
  throw new Error(`unknown EXTRACTOR '${env.EXTRACTOR}' (use "workers-ai" or "claude")`);
}

function politeClients(env: Env): Pick<RunDeps, "http" | "geoHttp"> {
  const userAgent = `zavody-kalendar/0.1 (+https://github.com/sankycz/zavody-kalendar; ${env.CONTACT_EMAIL})`;
  return {
    http: new PoliteClient({ userAgent, minIntervalMs: 5000 }),
    geoHttp: new PoliteClient({ userAgent, minIntervalMs: 1100 }),
  };
}

function deps(env: Env): RunDeps {
  return {
    db: env.DB,
    ...politeClients(env),
    llm: llm(env),
    ...(env.APIFY_TOKEN ? { apify: apifyEvents(env.APIFY_TOKEN, maxEvents(env)) } : {}),
    log: (msg, data) => console.log(msg, data ?? ""),
  };
}

async function tokenMatches(given: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    // Weekly, Monday 05:00 Prague time: two UTC crons cover summer and winter time.
    if (pragueHour(new Date(controller.scheduledTime)) !== INGEST_HOUR) return;
    const d = deps(env);
    const today = todayInPrague();
    // Next season's calendars as soon as the organizers publish them (no code change per year).
    console.log(JSON.stringify(await rollover(env.DB, d.http, today)));
    // Sources whose content didn't change are skipped by hash (no model call).
    console.log(JSON.stringify(await runAll(d)));
    console.log(`marked finished: ${await markFinished(env.DB, today)}`);
    // Then organizer websites of races in the next two weeks (model only when the page changed).
    console.log(JSON.stringify(await checkOrganizers(d, today, checkLimit(env))));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Admin endpoints, POST with "Authorization: Bearer <ADMIN_TOKEN>":
    //   /admin/run[?source=<id>][&force=1]   calendar ingest
    //   /admin/check-organizers[?limit=<n>]  organizer website check
    //   /admin/rollover                      add next season's sources (also weekly)
    //   /admin/geocode[?limit=<n>]           coordinates for stored events without them
    //   /admin/merge?keep=<id>&drop=<id>     merge a duplicate race into another one
    if (url.pathname.startsWith("/admin/")) {
      if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      const auth = request.headers.get("Authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!(await tokenMatches(token, env.ADMIN_TOKEN))) return new Response("Unauthorized", { status: 401 });
    }

    if (url.pathname === "/admin/check-organizers") {
      return Response.json(await checkOrganizers(deps(env), todayInPrague(), checkLimit(env, url.searchParams.get("limit"))));
    }

    if (url.pathname === "/admin/rollover") {
      return Response.json(await rollover(env.DB, deps(env).http, todayInPrague()));
    }

    if (url.pathname === "/admin/geocode") {
      // Workers Free allows 50 subrequests per request; each uncached place is one.
      const n = Number(url.searchParams.get("limit") ?? 40);
      const limit = Number.isInteger(n) && n > 0 && n <= 40 ? n : 40;
      return Response.json(await backfillCoordinates(env.DB, deps(env).geoHttp, limit));
    }

    if (url.pathname === "/admin/merge") {
      const [keep, drop] = [url.searchParams.get("keep") ?? "", url.searchParams.get("drop") ?? ""];
      if (!/^[0-9a-f]{32}$/.test(keep) || !/^[0-9a-f]{32}$/.test(drop)) return Response.json({ error: "keep and drop must be event ids" }, { status: 400 });
      return Response.json({ merged: await mergeEvents(env.DB, keep, drop) });
    }

    if (url.pathname === "/admin/run") {
      const reports = await runAll(deps(env), {
        ...(url.searchParams.get("source") ? { sourceId: url.searchParams.get("source")! } : {}),
        force: url.searchParams.get("force") === "1",
      });
      await markFinished(env.DB, todayInPrague());
      return Response.json(reports);
    }

    const doc = /^\/api\/events\/([0-9a-f]{32})\/doc$/.exec(url.pathname);
    if (doc && request.method === "GET") {
      const { http } = politeClients(env);
      return handleDoc(request, doc[1]!, { db: env.DB, get: (u) => http.get(u), cache: caches.default });
    }

    if (url.pathname.startsWith("/api/")) return handleApi(request, env.DB);

    // Everything else is served from static assets (the web app) before reaching the Worker.
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
