# CLAUDE.md — Kalendář závodů aut v ČR

Kompletní zadání je v `docs/SPEC.md`. Čti ho před každou změnou.

## Nemenná pravidla
- Jen automobilové disciplíny, žádné moto. Bez uživatelských účtů, výsledků, přihlášek a notifikací ve v1.
- Extrakce dat přes Claude API s pevným JSON schématem, žádné ruční parsery pro jednotlivé weby. Model z env `CLAUDE_MODEL`.
- `ANTHROPIC_API_KEY` jen v Supabase secrets, nikdy ve frontendu.
- Výstup modelu validuj zod; nevalidní položky zaloguj a přeskoč.
- Dedupe: normalizované místo + datum začátku + disciplína. Při konfliktu vyhrává Autoklub ČR. Zmizelé závody nemazat.
- Nominatim max. 1 req/s, cache v `locations`. Scraping: robots.txt, vlastní User-Agent s kontaktem, max. 1 req / pár sekund na doménu.
- Neukládat osobní údaje jezdců (Edda Cup seznamy jezdců nestahovat).
- URL zdrojů podle sezóny v tabulce `sources`, nový rok bez změny kódu.
- Hosting frontendu: Cloudflare Pages. Supabase projekt: viz `supabase/`.
- Každá tabulka v `public`: GRANT + ENABLE RLS + policy ve stejné migraci. Anon jen čte `sources`, `events`, `event_sources`; zapisuje jen service_role (edge funkce).
- Frontend: Vite + React + TypeScript strict + Tailwind + Leaflet/OSM. Česky, mobile-first, světlý/tmavý režim, filtry v URL.
- Pro každý zdroj fixture v `fixtures/` a test normalizace + deduplikace bez volání API.

## Postup
Pracuj po krocích z `docs/SPEC.md` („Pořadí práce“). Po každém kroku se zastav a ukaž výsledek.
