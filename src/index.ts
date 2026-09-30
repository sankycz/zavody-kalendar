import Anthropic from "@anthropic-ai/sdk";
import { handleApi, todayInPrague } from "./api.ts";
import { PoliteClient } from "./pipeline/http.ts";
import { claudeModel, workersAiModel, type AiBinding, type JsonModel } from "./pipeline/llm.ts";
import { checkOrganizers, DEFAULT_CHECK_LIMIT } from "./pipeline/organizer.ts";
import { markFinished, runAll, type RunDeps } from "./pipeline/run.ts";

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
  /** Max organizer websites checked per daily run (default 10). */
  ORGANIZER_CHECK_LIMIT?: string;
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

function deps(env: Env): RunDeps {
  const userAgent = `zavody-kalendar/0.1 (+https://github.com/sankycz/zavody-kalendar; ${env.CONTACT_EMAIL})`;
  return {
    db: env.DB,
    http: new PoliteClient({ userAgent, minIntervalMs: 5000 }),
    geoHttp: new PoliteClient({ userAgent, minIntervalMs: 1100 }),
    llm: llm(env),
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
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    // Daily: sources whose content didn't change are skipped by hash (no model call).
    console.log(JSON.stringify(await runAll(deps(env))));
    const today = todayInPrague();
    console.log(`marked finished: ${await markFinished(env.DB, today)}`);
    // Then organizer websites of races in the next two weeks (model only when the page changed).
    console.log(JSON.stringify(await checkOrganizers(deps(env), today, checkLimit(env))));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Admin endpoints, POST with "Authorization: Bearer <ADMIN_TOKEN>":
    //   /admin/run[?source=<id>][&force=1]   calendar ingest
    //   /admin/check-organizers[?limit=<n>]  organizer website check
    if (url.pathname.startsWith("/admin/")) {
      if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      const auth = request.headers.get("Authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!(await tokenMatches(token, env.ADMIN_TOKEN))) return new Response("Unauthorized", { status: 401 });
    }

    if (url.pathname === "/admin/check-organizers") {
      return Response.json(await checkOrganizers(deps(env), todayInPrague(), checkLimit(env, url.searchParams.get("limit"))));
    }

    if (url.pathname === "/admin/run") {
      const reports = await runAll(deps(env), {
        ...(url.searchParams.get("source") ? { sourceId: url.searchParams.get("source")! } : {}),
        force: url.searchParams.get("force") === "1",
      });
      await markFinished(env.DB, todayInPrague());
      return Response.json(reports);
    }

    if (url.pathname.startsWith("/api/")) return handleApi(request, env.DB);

    // Everything else is served from static assets (the web app) before reaching the Worker.
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
