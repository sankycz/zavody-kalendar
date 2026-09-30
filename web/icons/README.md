# Ikony

Zdroje ikon aplikace. Vykreslené soubory jsou ve `web/public/` (Vite je kopíruje do `dist/`).

| Zdroj | Výstup | Použití |
|---|---|---|
| `web/public/favicon.svg` | `favicon.svg`, `favicon-32.png` | záložka prohlížeče (jednoduchá vlaječka, čitelná v 16 px) |
| `app-icon.svg` | `icon-192.png`, `icon-512.png` | ikona aplikace (Android, manifest `any`) |
| `app-icon-maskable.svg` | `icon-maskable-512.png` | Android adaptivní ikona (manifest `maskable`, vlajka v bezpečné zóně 80 %) |
| `app-icon-full.svg` | `apple-touch-icon.png` (180 px) | iPhone „Přidat na plochu“ (bez zaoblení, iOS ho dělá sám) |

PNG se vykreslí ze SVG v Chromiu (Playwright): stránka s SVG v cílové velikosti, `screenshot({ omitBackground: true })`.
