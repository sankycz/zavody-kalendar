// Download real sample content of each source into fixtures/<provider>/.
// Respects robots.txt and spaces requests per host (same client as the Worker).
// Usage: CONTACT_EMAIL=you@example.com npm run fixtures:fetch [provider|source-id]
//        npm run fixtures:fetch -- --offline [provider|source-id]
//   --offline: don't download; regenerate <id>.txt from an <id>.html already in
//   fixtures/ (e.g. saved via Apify when the network here can't reach the source).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeHtml } from "../src/pipeline/decode.ts";
import { htmlToText } from "../src/pipeline/htmlToText.ts";
import { PoliteClient } from "../src/pipeline/http.ts";

const SOURCES = [
  { id: "autoklub-cal-pdf-2026", provider: "autoklub-cal", kind: "pdf", url: "https://www.autoklub.cz/wp-content/uploads/2026/01/cal-predbezny-26-v6.pdf" },
  { id: "autoklub-cal-html-2026", provider: "autoklub-cal", kind: "html", url: "https://www.autoklub.cz/205368-kalendar-automobiloveho-sportu-acr-2026/" },
  { id: "autokaleidoskop-2026", provider: "autokaleidoskop", kind: "html", url: "https://www.autokaleidoskop.cz/Kalendar/AKTUALIZACE:-Kalendar-automobilovych-zavodu-v-CR-2026/" },
  { id: "edda-2026", provider: "edda", kind: "html", url: "http://www.edda.cz/mscrdovrchu/index.php?m=trate" },
  { id: "cmpr-2026", provider: "cmpr", kind: "html", url: "https://cmpr.cz/souteze-poharu/" },
  { id: "triola-2026", provider: "triola", kind: "html", url: "http://www.triola-cup.cz/kalendar/" },
  { id: "krusnohorsky-pohar-2026", provider: "krusnohorsky-pohar", kind: "html", url: "https://www.krusnohorskypohar.cz/index.php/2025/12/01/kalendar-2026/" },
  { id: "autodrom-most-2026", provider: "autodrom-most", kind: "html", url: "https://www.autodrom-most.cz/kalendar-zavodu-c1423/" },
  { id: "automotodrom-brno-2026", provider: "automotodrom-brno", kind: "html", url: "https://www.automotodrombrno.cz/kalendar-akci/" },
] as const;

const args = process.argv.slice(2);
const offline = args.includes("--offline");
const only = args.find((a) => !a.startsWith("--"));
const selected = SOURCES.filter((s) => !only || s.id === only || s.provider === only);

if (offline) {
  for (const s of selected.filter((s) => s.kind === "html")) {
    const html = join(import.meta.dirname, "..", "fixtures", s.provider, `${s.id}.html`);
    if (!existsSync(html)) {
      console.error(`skip ${s.id}: ${html} not found`);
      continue;
    }
    const text = htmlToText(decodeHtml(new Uint8Array(readFileSync(html)), null), s.url);
    writeFileSync(html.replace(/\.html$/, ".txt"), text);
    console.log(`ok   ${s.id} (${text.length} chars of text)`);
  }
  process.exit(0);
}

const contact = process.env.CONTACT_EMAIL;
if (!contact) throw new Error("Set CONTACT_EMAIL for the User-Agent");
const http = new PoliteClient({
  userAgent: `zavody-kalendar/0.1 (+https://github.com/sankycz/zavody-kalendar; ${contact})`,
  minIntervalMs: 5000,
});

for (const s of selected) {
  const dir = join(import.meta.dirname, "..", "fixtures", s.provider);
  mkdirSync(dir, { recursive: true });
  try {
    const res = await http.get(s.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    writeFileSync(join(dir, `${s.id}.${s.kind}`), bytes);
    if (s.kind === "html") {
      writeFileSync(join(dir, `${s.id}.txt`), htmlToText(decodeHtml(bytes, res.headers.get("Content-Type")), s.url));
    }
    console.log(`ok   ${s.id} (${bytes.length} B)`);
  } catch (err) {
    console.error(`fail ${s.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
