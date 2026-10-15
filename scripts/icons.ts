// Icons and the link preview image from the one logo (web/src/logo.ts):
//   favicon.svg, favicon-32.png, apple-touch-icon.png (180, no transparency),
//   icon-192/512.png, icon-maskable-512.png (drawing inside the safe circle),
//   og-image.png (1200×630, shared link to the app).
// Run after changing the logo: npm run icons. Needs Playwright with Chromium
// (local or global install, e.g. npx playwright install chromium).
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { logoDataUrl, logoSvg } from "../web/src/logo.ts";

const OUT = join(import.meta.dirname, "../web/public");
const require = createRequire(import.meta.url);

/** The bits of Playwright used here (it is not a dependency of the project). */
type Page = {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  setContent(html: string): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  screenshot(options: { type: "png"; omitBackground?: boolean }): Promise<Uint8Array>;
};
type Playwright = { chromium: { launch(): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }> } };

function loadPlaywright(): Playwright {
  const paths = [process.cwd()];
  try {
    paths.push(execSync("npm root -g", { encoding: "utf8" }).trim());
  } catch {
    /* no global npm root */
  }
  return require(require.resolve("playwright", { paths }));
}

const OG_HTML = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><style>
body{margin:0;width:1200px;height:630px;overflow:hidden;font-family:Inter,system-ui,sans-serif;background:#06070b;color:#eef0f5;position:relative}
.glow{position:absolute;inset:0;background:radial-gradient(700px 500px at 1050px 80px,rgba(225,29,46,.45),transparent 70%),radial-gradient(600px 420px at 1150px 640px,rgba(255,122,24,.3),transparent 70%)}
.check{position:absolute;right:0;top:0;bottom:0;width:120px;opacity:.1;background:conic-gradient(#fff 25%,transparent 0 50%,#fff 0 75%,transparent 0) 0 0/60px 60px}
.wrap{position:absolute;left:84px;top:78px;right:220px}
img{width:132px;height:132px;border-radius:30px;box-shadow:0 18px 50px rgba(225,29,46,.35)}
h1{font-family:'Inter Display',Inter,sans-serif;font-weight:800;font-size:88px;letter-spacing:-2.5px;margin:38px 0 14px;line-height:1}
h1 span{background:linear-gradient(90deg,#e11d2e,#ff7a18);-webkit-background-clip:text;color:transparent}
p{font-size:32px;color:#9aa0ad;margin:0 0 36px;font-weight:500}
.chips{display:flex;gap:14px}
.chip{font-size:24px;font-weight:600;padding:12px 24px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12)}
.url{position:absolute;left:84px;bottom:44px;font-size:26px;font-weight:700;color:#eef0f5;opacity:.75}
</style></head><body><div class="glow"></div><div class="check"></div>
<div class="wrap"><img src="${logoDataUrl()}"><h1>Závody aut <span>v ČR</span></h1>
<p>Kalendář automobilových závodů v Česku</p>
<div class="chips"><div class="chip">Rally</div><div class="chip">Vrchy</div><div class="chip">Autokros</div><div class="chip">Slalom</div><div class="chip">Okruhy</div></div></div>
<div class="url">zavody-aut.cz</div></body></html>`;

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage();

async function png(file: string, size: number, svg: string) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body>`);
  writeFileSync(join(OUT, file), await page.screenshot({ type: "png", omitBackground: false }));
}

writeFileSync(join(OUT, "favicon.svg"), `${logoSvg({ radius: 112 })}\n`);
await png("favicon-32.png", 32, logoSvg({ radius: 7, scale: 0.9 }));
await png("apple-touch-icon.png", 180, logoSvg());
await png("icon-192.png", 192, logoSvg());
await png("icon-512.png", 512, logoSvg());
await png("icon-maskable-512.png", 512, logoSvg({ scale: 0.64 }));

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(OG_HTML);
await page.evaluate("document.fonts.ready");
writeFileSync(join(OUT, "og-image.png"), await page.screenshot({ type: "png" }));

await browser.close();
console.log("icons written to web/public/");
