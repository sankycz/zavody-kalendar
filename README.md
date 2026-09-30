# Kalendář závodů aut v ČR

Kalendář amatérských i mistrovských automobilových závodů v Česku (rally, vrchy, autocross, slalom, okruhy…) na jednom místě — seznam, mapa a detail s odkazem na pořadatele a zdroj.

- Zadání: [`docs/SPEC.md`](docs/SPEC.md)
- Pravidla pro AI asistenta: [`CLAUDE.md`](CLAUDE.md)

Stack: Cloudflare D1 + Workers (Cron Triggers, static assets) · Workers AI nebo Claude API pro extrakci dat · Nominatim · Vite + React + TypeScript + Tailwind + Leaflet.

## Vývoj

```bash
npm i
npm test            # normalizace, deduplikace, upsert, API (bez sítě a bez volání modelu)
npm run typecheck

npx wrangler d1 migrations apply zavody-kalendar --local   # lokální kopie D1
npm run dev:api     # Worker + API na :8787
npm run dev         # frontend na :5173 (proxy /api na :8787)
```

Web (`web/`) je Vite + React + Tailwind a nasazuje se spolu s Workerem jako jeho statické soubory: `/api/*` a `/admin/*` obslouží Worker, všechno ostatní je aplikace.

## Nasazení stahovacího Workeru

```bash
npx wrangler login
# Extrakce běží ve výchozím stavu přes Workers AI (EXTRACTOR v wrangler.jsonc), klíč netřeba.
# Pro Claude API: EXTRACTOR="claude" a  npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ADMIN_TOKEN          # libovolný dlouhý náhodný řetězec
npm run deploy                               # build webu + Worker + denní Cron Trigger (03:17 UTC)

# ruční spuštění (jen Autoklub, i když se obsah nezměnil):
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://zavody-kalendar.<subdomena>.workers.dev/admin/run?source=autoklub-cal-pdf-2026&force=1"

# ruční kontrola webů pořadatelů (závody v příštích 14 dnech):
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://zavody-kalendar.<subdomena>.workers.dev/admin/check-organizers?limit=10"
```

Pipeline (`src/pipeline/`): `http.ts` (robots.txt, User-Agent, rozestupy) → hash obsahu → `htmlToText.ts` / PDF jako dokument → `extract.ts` (Claude, strukturovaný výstup) → `normalize.ts` (validace po položkách) → `dedupe.ts` → `geocode.ts` (Nominatim + cache) → `upsert.ts` (D1, priorita zdrojů). Po importu `organizer.ts` denně ověří weby pořadatelů nadcházejících závodů (tabulka `organizer_checks`).
