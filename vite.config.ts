import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist", emptyOutDir: true },
  // `npm run dev:api` (wrangler dev) serves the API on :8787.
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
