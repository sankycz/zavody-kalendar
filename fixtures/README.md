# Fixtures

Vzorový obsah zdrojů pro testy, které běží bez volání API.

| Soubor | Co to je |
|---|---|
| `<provider>/<source-id>.pdf` / `.html` | Reálný stažený obsah zdroje (`npm run fixtures:fetch`). |
| `<provider>/<source-id>.txt` | HTML převedené na text přes `htmlToText` – to, co jde do modelu. |
| `<provider>/extraction.sample.json` | Výstup modelu ve tvaru `ExtractionSchema`. Nad ním testy pouští normalizaci, deduplikaci a upsert do D1. |

## Stav

- Všechny tři `extraction.sample.json` (`autoklub-cal`, `autokaleidoskop`, `edda`) jsou zatím **syntetické**: smyšlené závody se schválně vloženými chybami (překlepy v datech, duplicity, prázdný název, nepovolená disciplína) a s překryvy mezi zdroji (posun data o den, stejný závod v Autoklubu i v Edda Cupu). Nad nimi běží testy normalizace a deduplikace napříč zdroji (`test/crossSource.test.ts`).
- Cloudové prostředí nemá síťový přístup na weby zdrojů (proxy je blokuje), takže `fixtures:fetch` tam končí na HTTP 403. Reálné stránky se stáhnou lokálně, nebo v Claude session přes Apify connector.
- Reálné HTML staženo přes Apify (`apify/web-fetch`, 1 stránka, bez následování odkazů) 30. 9. 2026:
  - `edda/edda-2026.html` – surové HTML stránky „Tratě“ (seznamy jezdců nestaženy).
  - `autokaleidoskop/autokaleidoskop-2026.html` – surové HTML článku.
  - `autoklub-cal/autoklub-cal-html-2026.html` – HTML **očištěné Apify** (jen hlavička + článek s tabulkami, bez WordPress menu/patičky); surové HTML má ~120 kB. Obsah kalendáře je stejný.
  - `.txt` k nim vygenerované přes `--offline`.
- `autoklub-cal/autoklub-cal-pdf-2026.pdf` zatím chybí (binární 185 kB soubor nejde přenést přes Apify connector) – stáhni lokálně `npm run fixtures:fetch autoklub-cal-pdf-2026`.
- Až bude první ostrá extrakce nad reálnými `.txt`, syntetické vzorky se nahradí skutečným výstupem modelu.

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
