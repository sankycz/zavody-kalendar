# Kalendář závodů aut v ČR

Kalendář amatérských i mistrovských automobilových závodů v Česku (rally, vrchy, autocross, slalom, okruhy…) na jednom místě — seznam, mapa a detail s odkazem na pořadatele a zdroj.

- Zadání: [`docs/SPEC.md`](docs/SPEC.md)
- Pravidla pro AI asistenta: [`CLAUDE.md`](CLAUDE.md)

Stack: Cloudflare D1 + Workers (Cron Triggers) + Pages · Claude API pro extrakci dat · Nominatim · Vite + React + TypeScript + Tailwind + Leaflet.

## Vývoj

```bash
npm i
npm test            # normalizace, deduplikace, upsert do D1 schématu (bez sítě a bez API)
npm run typecheck
```

## Nasazení stahovacího Workeru

```bash
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ADMIN_TOKEN          # libovolný dlouhý náhodný řetězec
npm run deploy                               # Worker + týdenní Cron Trigger (po 03:17 UTC)

# ruční spuštění (jen Autoklub, i když se obsah nezměnil):
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://zavody-kalendar.<subdomena>.workers.dev/admin/run?source=autoklub-cal-pdf-2026&force=1"
```

Pipeline (`src/pipeline/`): `http.ts` (robots.txt, User-Agent, rozestupy) → hash obsahu → `htmlToText.ts` / PDF jako dokument → `extract.ts` (Claude, strukturovaný výstup) → `normalize.ts` (validace po položkách) → `dedupe.ts` → `geocode.ts` (Nominatim + cache) → `upsert.ts` (D1, priorita zdrojů).
