import Anthropic from "@anthropic-ai/sdk";
import { handleApi } from "./api.ts";
import { PoliteClient } from "./pipeline/http.ts";
import { runAll, type RunDeps } from "./pipeline/run.ts";

export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  ADMIN_TOKEN: string;
  CLAUDE_MODEL: string;
  CONTACT_EMAIL: string;
}

function deps(env: Env): RunDeps {
  if (!env.CLAUDE_MODEL) throw new Error("CLAUDE_MODEL is not set");
  const userAgent = `zavody-kalendar/0.1 (+https://github.com/sankycz/zavody-kalendar; ${env.CONTACT_EMAIL})`;
  return {
    db: env.DB,
    http: new PoliteClient({ userAgent, minIntervalMs: 5000 }),
    geoHttp: new PoliteClient({ userAgent, minIntervalMs: 1100 }),
    claude: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
    model: env.CLAUDE_MODEL,
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
    console.log(JSON.stringify(await runAll(deps(env))));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // POST /admin/run[?source=<id>][&force=1] with "Authorization: Bearer <ADMIN_TOKEN>"
    if (url.pathname === "/admin/run") {
      if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      const auth = request.headers.get("Authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!(await tokenMatches(token, env.ADMIN_TOKEN))) return new Response("Unauthorized", { status: 401 });

      const reports = await runAll(deps(env), {
        ...(url.searchParams.get("source") ? { sourceId: url.searchParams.get("source")! } : {}),
        force: url.searchParams.get("force") === "1",
      });
      return Response.json(reports);
    }

    if (url.pathname.startsWith("/api/")) return handleApi(request, env.DB);

    // Everything else is served from static assets (the web app) before reaching the Worker.
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
