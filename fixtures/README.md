# Fixtures

Vzorový obsah zdrojů pro testy, které běží bez volání API.

| Soubor | Co to je |
|---|---|
| `<provider>/<source-id>.pdf` / `.html` | Reálný stažený obsah zdroje (`npm run fixtures:fetch`). |
| `<provider>/<source-id>.txt` | HTML převedené na text přes `htmlToText` – to, co jde do modelu. |
| `<provider>/extraction.sample.json` | Výstup modelu ve tvaru `ExtractionSchema`. Nad ním testy pouští normalizaci, deduplikaci a upsert do D1. |

## Stav

- `autoklub-cal/extraction.sample.json` je zatím **syntetický** (smyšlené závody se schválně vloženými chybami: překlepy v datech, duplicita, prázdný název). Cloudové prostředí, ve kterém vznikl, nemá přístup na autoklub.cz.
- Až poběží `fixtures:fetch` a první ostrá extrakce, nahradí se skutečným výstupem modelu nad staženým PDF (test pak ověří reálná data).

```bash
CONTACT_EMAIL=you@example.com npm run fixtures:fetch            # všechny zdroje
CONTACT_EMAIL=you@example.com npm run fixtures:fetch autoklub-cal  # jen jeden provider
```
