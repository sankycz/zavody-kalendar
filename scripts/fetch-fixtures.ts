// Download real sample content of each source into fixtures/<provider>/.
// Respects robots.txt and spaces requests per host (same client as the Worker).
// Usage: CONTACT_EMAIL=you@example.com npm run fixtures:fetch
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { htmlToText } from "../src/pipeline/htmlToText.ts";
import { PoliteClient } from "../src/pipeline/http.ts";

const SOURCES = [
  { id: "autoklub-cal-pdf-2026", provider: "autoklub-cal", kind: "pdf", url: "https://www.autoklub.cz/wp-content/uploads/2026/01/cal-predbezny-26-v6.pdf" },
  { id: "autoklub-cal-html-2026", provider: "autoklub-cal", kind: "html", url: "https://www.autoklub.cz/205368-kalendar-automobiloveho-sportu-acr-2026/" },
  { id: "autokaleidoskop-2026", provider: "autokaleidoskop", kind: "html", url: "https://www.autokaleidoskop.cz/Kalendar/AKTUALIZACE:-Kalendar-automobilovych-zavodu-v-CR-2026/" },
  { id: "edda-2026", provider: "edda", kind: "html", url: "http://www.edda.cz/mscrdovrchu/index.php?m=trate" },
] as const;

const contact = process.env.CONTACT_EMAIL;
if (!contact) throw new Error("Set CONTACT_EMAIL for the User-Agent");
const http = new PoliteClient({
  userAgent: `zavody-kalendar/0.1 (+https://github.com/sankycz/zavody-kalendar; ${contact})`,
  minIntervalMs: 5000,
});

const only = process.argv[2];
for (const s of SOURCES.filter((s) => !only || s.id === only || s.provider === only)) {
  const dir = join(import.meta.dirname, "..", "fixtures", s.provider);
  mkdirSync(dir, { recursive: true });
  try {
    const res = await http.get(s.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    writeFileSync(join(dir, `${s.id}.${s.kind}`), bytes);
    if (s.kind === "html") {
      writeFileSync(join(dir, `${s.id}.txt`), htmlToText(new TextDecoder().decode(bytes), s.url));
    }
    console.log(`ok   ${s.id} (${bytes.length} B)`);
  } catch (err) {
    console.error(`fail ${s.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
