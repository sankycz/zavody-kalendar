# CLAUDE.md — Kalendář závodů aut v ČR

Kompletní zadání je v `docs/SPEC.md`. Čti ho před každou změnou.

## Nemenná pravidla
- Jen automobilové disciplíny, žádné moto. Bez uživatelských účtů, výsledků, přihlášek a notifikací ve v1.
- Extrakce dat přes Claude API s pevným JSON schématem, žádné ruční parsery pro jednotlivé weby. Model z env `CLAUDE_MODEL`.
- `ANTHROPIC_API_KEY` jen ve Worker secrets, nikdy ve frontendu.
- Výstup modelu validuj zod; nevalidní položky zaloguj a přeskoč.
- Dedupe: normalizované místo + datum začátku + disciplína. Při konfliktu vyhrává Autoklub ČR. Zmizelé závody nemazat.
- Nominatim max. 1 req/s, cache v `locations`. Scraping: robots.txt, vlastní User-Agent s kontaktem, max. 1 req / pár sekund na doménu.
- Neukládat osobní údaje jezdců (Edda Cup seznamy jezdců nestahovat).
- URL zdrojů podle sezóny v tabulce `sources`, nový rok bez změny kódu.
- Vše na Cloudflare: D1 (`zavody-kalendar`, binding `DB`, `wrangler.jsonc`), Worker pro stahování (Cron Trigger) a read-only API, frontend na Cloudflare Pages.
- Schéma měň jen novou migrací v `migrations/NNNN_*.sql` (`wrangler d1 migrations apply`), aplikované migrace neupravuj. Data jako ISO text `YYYY-MM-DD`.
- D1 není veřejná: frontend jen přes read-only API, zapisuje jen ingest Worker; admin endpoint chráněný tokenem ze secrets.
- Frontend: Vite + React + TypeScript strict + Tailwind + Leaflet/OSM. Česky, mobile-first, světlý/tmavý režim, filtry v URL.
- Pro každý zdroj fixture v `fixtures/` a test normalizace + deduplikace bez volání API.

## Postup
Pracuj po krocích z `docs/SPEC.md` („Pořadí práce“). Po každém kroku se zastav a ukaž výsledek.
