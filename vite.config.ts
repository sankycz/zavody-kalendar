import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build, defineConfig, type Plugin } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url).href);

/**
 * Service worker (web/sw/sw.ts) as a classic script `sw.js` next to the app,
 * with the list of built files to precache and a version that changes with them.
 */
function serviceWorker(): Plugin {
  return {
    name: "service-worker",
    apply: "build",
    async generateBundle(_options, bundle) {
      const publicDir = here("web/public/");
      // _headers is for Cloudflare, not for the browser.
      const publicFiles = readdirSync(publicDir).filter((f) => !f.startsWith("_"));
      const built = Object.keys(bundle).filter((f) => f !== "index.html" && !f.endsWith(".map"));
      const hash = createHash("sha256");
      for (const f of built) {
        const item = bundle[f]!;
        hash.update(f).update(item.type === "chunk" ? item.code : item.source);
      }
      for (const f of publicFiles) hash.update(f).update(readFileSync(publicDir + f));
      const index = bundle["index.html"];
      if (index?.type === "asset") hash.update(index.source);

      const out = await build({
        configFile: false,
        logLevel: "warn",
        publicDir: false,
        define: {
          __PRECACHE__: JSON.stringify(["/", ...[...built, ...publicFiles].map((f) => `/${f}`)]),
          __VERSION__: JSON.stringify(hash.digest("hex").slice(0, 12)),
        },
        build: {
          write: false,
          emptyOutDir: false,
          minify: true,
          lib: { entry: here("web/sw/sw.ts"), formats: ["iife"], name: "sw", fileName: () => "sw.js" },
        },
      });
      const output = (Array.isArray(out) ? out[0]! : out) as { output: { type: string; code?: string }[] };
      const chunk = output.output.find((o) => o.type === "chunk");
      if (!chunk?.code) throw new Error("service worker build produced no code");
      this.emitFile({ type: "asset", fileName: "sw.js", source: chunk.code });
    },
  };
}

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss(), serviceWorker()],
  build: { outDir: "../dist", emptyOutDir: true },
  // `npm run dev:api` (wrangler dev) serves the API on :8787.
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
