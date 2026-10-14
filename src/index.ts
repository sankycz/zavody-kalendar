import Anthropic from "@anthropic-ai/sdk";
import { handleApi, pragueHour, todayInPrague } from "./api.ts";
import { handleDoc } from "./docs.ts";
import { apifyEvents } from "./pipeline/facebook.ts";
import { backfillCoordinates } from "./pipeline/geocode.ts";
import { PoliteClient } from "./pipeline/http.ts";
import { rollover } from "./pipeline/rollover.ts";
import { claudeModel, workersAiModel, type AiBinding, type JsonModel } from "./pipeline/llm.ts";
import { checkOrganizers, DEFAULT_CHECK_LIMIT, LIVE_WINDOW_DAYS } from "./pipeline/organizer.ts";
import { markFinished, runAll, type RunDeps } from "./pipeline/run.ts";
import { checkStages, DEFAULT_STAGE_LIMIT } from "./pipeline/stages.ts";
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
  /** Max races whose stage documents are read per run (default 5). */
  STAGE_CHECK_LIMIT?: string;
}

/** Local (Prague) hour of the weekly run, see the crons in wrangler.jsonc. */
const INGEST_HOUR = 5;
/** Start no new source after this long into the daily run (Cron Triggers stop at 15 min; a source can take minutes). */
const INGEST_BUDGET_MS = 9 * 60_000;
/** A calendar source is fetched again after this long: about weekly, but at the same hour a week later. */
const SOURCE_INTERVAL_MS = 6.5 * 24 * 3600_000;

function maxEvents(env: Env): number {
  const n = Number(env.APIFY_MAX_EVENTS ?? 50);
  return Number.isInteger(n) && n > 0 && n <= 500 ? n : 50;
}

function checkLimit(env: Env, override?: string | null): number {
  const n = Number(override ?? env.ORGANIZER_CHECK_LIMIT ?? DEFAULT_CHECK_LIMIT);
  return Number.isInteger(n) && n >= 0 && n <= 50 ? n : DEFAULT_CHECK_LIMIT;
}

function stageLimit(env: Env, override?: string | null): number {
  const n = Number(override ?? env.STAGE_CHECK_LIMIT ?? DEFAULT_STAGE_LIMIT);
  return Number.isInteger(n) && n >= 0 && n <= 20 ? n : DEFAULT_STAGE_LIMIT;
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
    // Daily 05:00 Prague time (two UTC crons cover summer and winter time).
    const at = new Date(controller.scheduledTime);
    if (pragueHour(at) !== INGEST_HOUR) return;
    const d = deps(env);
    const today = todayInPrague(at);
    if (new Date(`${today}T00:00:00Z`).getUTCDay() === 1) {
      // Mondays: next season's calendars as soon as the organizers publish them (no code change per year),
      // organizer websites of races in the next two weeks (model only when the page changed).
      console.log(JSON.stringify(await rollover(env.DB, d.http, today)));
      console.log(JSON.stringify(await checkOrganizers(d, today, checkLimit(env))));
    } else {
      // Other days: organizer websites of races today and tomorrow (race-day view: results, stream),
      // stages and road closures of rallies and hill climbs in the next two weeks.
      console.log(JSON.stringify(await checkOrganizers(d, today, checkLimit(env), LIVE_WINDOW_DAYS)));
      console.log(JSON.stringify(await checkStages(d, today, stageLimit(env))));
    }
    // Calendars every day, each source about once a week: the model's daily allowance
    // (Workers AI free plan) and the 15 minutes of a Cron Trigger don't fit all of them in one run.
    // Unchanged sources are skipped by hash (no model call); the rest go first the next day.
    const fetchedBefore = new Date(at.getTime() - SOURCE_INTERVAL_MS).toISOString();
    console.log(JSON.stringify(await runAll(d, { deadline: at.getTime() + INGEST_BUDGET_MS, fetchedBefore })));
    console.log(`marked finished: ${await markFinished(env.DB, today)}`);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Admin endpoints, POST with "Authorization: Bearer <ADMIN_TOKEN>":
    //   /admin/run[?source=<id>][&force=1]   calendar ingest
    //   /admin/check-organizers[?limit=<n>]  organizer website check
    //   /admin/check-stages[?limit=<n>]      stages and road closures from race documents
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

    if (url.pathname === "/admin/check-stages") {
      return Response.json(await checkStages(deps(env), todayInPrague(), stageLimit(env, url.searchParams.get("limit"))));
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
