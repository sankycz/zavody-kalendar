# Fixtures

Vzorový obsah zdrojů pro testy, které běží bez volání API.

| Soubor | Co to je |
|---|---|
| `<provider>/<source-id>.pdf` / `.html` | Reálný stažený obsah zdroje (`npm run fixtures:fetch`). |
| `<provider>/<source-id>.txt` | HTML převedené na text přes `htmlToText` – to, co jde do modelu. |
| `<provider>/extraction.sample.json` | Syntetický výstup modelu ve tvaru `ExtractionSchema` se schválně vloženými chybami. Nad ním testy pouští normalizaci, deduplikaci a upsert do D1. |
| `<provider>/<source-id>.extraction.json` | Reálný výstup modelu nad `.txt` / `.pdf` (`npm run fixtures:extract`). Testuje ho `test/realExtraction.test.ts`, bez volání API. |

## Stav

- Všechny tři `extraction.sample.json` (`autoklub-cal`, `autokaleidoskop`, `edda`) jsou zatím **syntetické**: smyšlené závody se schválně vloženými chybami (překlepy v datech, duplicity, prázdný název, nepovolená disciplína) a s překryvy mezi zdroji (posun data o den, stejný závod v Autoklubu i v Edda Cupu). Nad nimi běží testy normalizace a deduplikace napříč zdroji (`test/crossSource.test.ts`).
- Cloudové prostředí nemá síťový přístup na weby zdrojů (proxy je blokuje), takže `fixtures:fetch` tam končí na HTTP 403. Reálné stránky se stáhnou lokálně, nebo v Claude session přes Apify connector.
- Reálné HTML staženo přes Apify (`apify/web-fetch`, 1 stránka, bez následování odkazů) 30. 9. 2026:
  - `edda/edda-2026.html` – surové HTML stránky „Tratě“ (seznamy jezdců nestaženy).
  - `autokaleidoskop/autokaleidoskop-2026.html` – surové HTML článku.
  - `autoklub-cal/autoklub-cal-html-2026.html` – HTML **očištěné Apify** (jen hlavička + článek s tabulkami, bez WordPress menu/patičky); surové HTML má ~120 kB. Obsah kalendáře je stejný.
  - Další zdroje (migrace `0005`), staženo přes Apify 30. 9. 2026:
    - `cmpr/cmpr-2026.html`, `krusnohorsky-pohar/…`, `autodrom-most/…`, `automotodrom-brno/…` – HTML očištěné Apify (hlavní obsah stránky).
    - `triola/triola-2026.html` – surové HTML bez inline skriptu na konci (skripty `htmlToText` stejně zahodí).
    - V `automotodrom-brno` je název jedné akce (soukromý pronájem okruhu, jméno osoby) nahrazen „Soukromá akce“.
    - Vynechané zdroje a důvody jsou v `migrations/0005_more_sources_2026.sql`.
  - `.txt` k nim vygenerované přes `--offline`.
- `autoklub-podniky/autoklub-podniky-2026.html` – skutečný markup první stránky (15 z 94 podniků) kalendáře podniků Autoklubu ČR včetně stránkování, staženo přes Apify 1. 10. 2026, bez hlavičky a formuláře. `.extraction.json` k ní vytvořil Claude podle `SYSTEM_PROMPT`. Stránkování testuje `test/paging.test.ts`.
- `facebook/facebook-2026.dataset.json` – reálný výstup Apify actoru `apify/facebook-events-scraper` (hledání „autoslalom“, „závod do vrchu“, „rallysprint“, 30. 9. 2026), jen pole, která pipeline používá. Pole s pořadateli (jména osob) vynechána, e-mail v jednom popisu nahrazen `example.no`. Test: `test/facebook.test.ts`.
- `autoklub-cal/autoklub-cal-pdf-2026.pdf` zatím chybí (binární 185 kB soubor nejde přenést přes Apify connector) – stáhni lokálně `npm run fixtures:fetch autoklub-cal-pdf-2026`.
- `*.extraction.json` (všechny HTML zdroje) teď vytvořil Claude v Claude Code session podle `SYSTEM_PROMPT` a schématu (bez API klíče, `model: "claude-code-session"`), ne `extractEvents()`. Karting a minikáry vynechány podle promptu, nejasná data (`1ý.`, `???`) zkopírována beze změny – normalizace je zahodí.
- Ostrá extrakce: `ANTHROPIC_API_KEY=… npm run fixtures:extract [provider|source-id]` (model z `CLAUDE_MODEL`, jinak z `wrangler.jsonc`). Syntetické `extraction.sample.json` zůstávají kvůli testům chybových případů.

```bash
CONTACT_EMAIL=you@example.com npm run fixtures:fetch            # všechny zdroje
CONTACT_EMAIL=you@example.com npm run fixtures:fetch autoklub-cal  # jen jeden provider
```

### Stažení přes Apify (když přímý přístup nejde)

1. Stáhni stránku přes Apify (např. actor *Website Content Crawler* / *Web Scraper*, max. 1 stránka, bez následování odkazů – u Edda Cupu nechceme stránky se seznamy jezdců) a surové HTML ulož jako `fixtures/<provider>/<source-id>.html`.
2. Vygeneruj text, který jde do modelu:

```bash
npm run fixtures:fetch -- --offline            # všechny uložené .html -> .txt
npm run fixtures:fetch -- --offline edda       # jen jeden provider
```

Apify slouží jen k pořízení fixtures při vývoji. Produkční stahování dělá Worker sám (robots.txt, vlastní User-Agent, limit na doménu).
