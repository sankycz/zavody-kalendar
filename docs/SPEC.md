# Kalendář amatérských automobilových závodů v ČR — zadání

Webová aplikace, která na jednom místě ukazuje závody aut v Česku. Hlavně amatérskou a regionální úroveň, ale MČR taky, protože amatéři na ně jezdí koukat a často i startovat. Uživatel chce vidět, kdy se co jede, jaký typ závodu to je, kde přesně a co o závodě ví pořadatel.

Data neexistují v jednom zdroji. Každý autoklub a seriál má vlastní web, vlastní formát a část kalendářů je jen v PDF. Největší část práce proto není frontend, ale spolehlivé stahování a sjednocování dat.

## Rozsah první verze

Seznam závodů s filtry podle disciplíny, úrovně, regionu a data. Mapa se všemi závody. Detail závodu s odkazem na pořadatele a na zdroj. Pravidelné automatické stahování ze zdrojů níže.

Do první verze nepatří uživatelské účty, výsledky závodů, přihlášky jezdců ani notifikace. Moto disciplíny zatím vynech, jen auta.

## Zdroje dat

Začni prvními třemi. Další přidávej až ve chvíli, kdy pipeline běží stabilně.

1. **Autoklub ČR**, souhrnný kalendář automobilového sportu. HTML stránka https://www.autoklub.cz/205368-kalendar-automobiloveho-sportu-acr-2026/ a PDF verze https://www.autoklub.cz/wp-content/uploads/2026/01/cal-predbezny-26-v6.pdf. PDF u rally rozlišuje MČR, RSS a volný závod, to je hlavní zdroj pro pole `level`.
2. **Autokaleidoskop**, průběžně aktualizovaný kalendář včetně regionálních rally a pohárů. https://www.autokaleidoskop.cz/Kalendar/AKTUALIZACE:-Kalendar-automobilovych-zavodu-v-CR-2026/ Text je špatně strukturovaný, s překlepy v datech. Počítej s tím.
3. **Edda Cup**, amatérské závody do vrchu. http://www.edda.cz/mscrdovrchu/index.php?m=trate

Kandidáti na později: Triola Cup, Krušnohorský pohár, Maverick Cup, Radeč Cup, kalendáře jednotlivých autoklubů, například https://www.autoklub-pisek.cz/kalendar/.

**Facebook** (zdroj s `sources.via = 'facebook'`): události přes Apify actor `apify/facebook-events-scraper` (API token ve Worker secretu `APIFY_TOKEN`, max. `APIFY_MAX_EVENTS` událostí na běh, platí se za událost). V `sources.url` je po řádcích, co stáhnout: odkaz na FB stránku pořadatele (záložka Události), na událost, nebo hledaná fráze. Hledání na FB je celosvětové, proto se berou jen události se zemí CZ a známým místem. Model z nich jako u webu vybere automobilové závody. Souřadnice místa se berou z Facebooku, geokodér jen doplní kraj. Kontakty z popisu se modelu neposílají a popis se neukládá.
Actor bere adresy tvaru `facebook.com/<stránka>/events`, `facebook.com/groups/<id>/events` nebo `facebook.com/profile.php?id=<id>&sk=events`; `…/upcoming_hosted_events` nevrací nic. Stav 30. 9. 2026: aktuální události má jen skupina ČMPR (duplicitní s cmpr.cz), FB stránky Trioly (2016) a Mavericku (2015) jsou neaktivní, EDDA Cup, Krušnohorský pohár a AmaterCup stránku s událostmi nemají. Zdroj `facebook-2026` je proto vypnutý (url = skupina ČMPR).

Kalendář obsahuje jen závody konané v České republice.

URL obsahují rok. Kalendář na další sezónu vychází v zimě, předběžný kalendář 2026 vyšel 28. 1. 2026. Konfigurace zdrojů proto musí umět URL pro nový rok přidat bez změny kódu.

Další sezónu přidává každý týdenní běh sám (`src/pipeline/rollover.ts`, ručně `POST /admin/rollover`): u zdroje bez řádku na příští rok zkusí 1) stejnou URL, když v ní rok není, 2) URL s rokem +1, pokud existuje a stránka o tom roce opravdu mluví, 3) odkaz na `sources.index_url` (rozcestník, kde pořadatel kalendář odkazuje), který obsahuje příští rok a je nejpodobnější současné URL; PDF se hledá na stránce příštího roku téhož poskytovatele. Dokud kalendář nevyjde, zkouší to každý týden znovu. Zdroje minulých sezón se vypnou.

## Architektura

- **Databáze:** Cloudflare D1 (SQLite), databáze `zavody-kalendar`, migrace v `migrations/`.
- **Stahování:** Cloudflare Worker (TypeScript), spouštěný Cron Triggerem jednou týdně (pondělí 5:00 českého času) a ručně přes admin endpoint chráněný tokenem.
- **Extrakce:** LLM s pevným JSON schématem – Cloudflare Workers AI (výchozí, zdarma v denním limitu, `EXTRACTOR=workers-ai`, model z `WORKERS_AI_MODEL`) nebo Claude API (`EXTRACTOR=claude`, model z `CLAUDE_MODEL`). Stažený HTML text nebo text z PDF pošli modelu a nech ho vrátit pole závodů. Parser pro každý web zvlášť nepiš, zdroje se mění a jsou nekonzistentní.
- **Geokódování:** Open-Meteo Geocoding API (data GeoNames, bez klíče), maximálně 1 požadavek za sekundu, výsledky cachuj v tabulce `locations`. Místo, které v dané zemi není, se hledá v sousedních (CZ, SK, DE, AT, PL). Nominatim nepoužíváme: jeho robots.txt zakazuje `/search` robotům.
- **Frontend:** Vite, React, TypeScript strict, Tailwind. Mapa přes Leaflet s OSM dlaždicemi.
- **Hosting frontendu:** Cloudflare Workers static assets — stejný Worker jako API a stahování (Cloudflare pro nové projekty doporučuje místo Pages). Auto-deploy z GitHubu přes Workers Builds.

Klíče patří do Cloudflare Worker secrets (`wrangler secret put`). `ANTHROPIC_API_KEY` nikdy nesmí skončit ve frontendu.

## Datový model

Závazné schéma je v `migrations/` (SQLite pro D1). Původní návrh níže je v Postgres syntaxi; ve skutečném schématu jsou `id` hex texty, data ISO texty `YYYY-MM-DD` (validované CHECKem), časy ISO 8601 UTC, booleany 0/1. Navíc: `sources` má `provider`, `name` a `priority` (jeden řádek = poskytovatel + sezóna + HTML/PDF, nižší priorita vyhrává konflikty), výčty hlídají CHECK constrainty, `event_sources` má `first_seen_at`/`last_seen_at`, `locations` má `found`/`fetched_at`. Databáze není veřejná — frontend čte přes read-only API ve Workeru.

```sql
create table sources (
  id text primary key,            -- 'autoklub-cal', 'autokaleidoskop', 'edda'
  url text not null,
  season int not null,
  kind text not null,             -- 'html' | 'pdf'
  last_fetched_at timestamptz,
  last_content_hash text,
  enabled boolean default true
);

create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date_from date not null,
  date_to date,
  discipline text not null,       -- rally, rallysprint, vrch, autocross, slalom,
                                  -- okruh, drift, regularity, historic, jiny
  series text,                    -- 'MČR v rally', 'Edda Cup', ...
  level text not null,            -- mcr | pohar | regionalni | volny
  location_name text,
  region text,                    -- kraj
  lat double precision,
  lng double precision,
  country text default 'CZ',
  organizer text,
  website_url text,
  description text,
  status text default 'planned',  -- planned | cancelled | finished
  dedupe_key text unique,
  updated_at timestamptz default now()
);

create table event_sources (
  event_id uuid references events(id) on delete cascade,
  source_id text references sources(id),
  source_url text not null,
  raw_excerpt text,
  primary key (event_id, source_id)
);

create table locations (
  query text primary key,
  lat double precision,
  lng double precision,
  region text
);
```

## Pipeline

1. Stáhni zdroj. Pokud se hash obsahu nezměnil od minula, skonči.
2. Z PDF vytáhni text, z HTML odstraň navigaci a patičku. *(Implementace: PDF se posílá modelu přímo jako dokument — zachová tabulkové rozložení s úrovněmi MČR/RSS a ve Workeru nestojí CPU čas.)*
3. Pošli text modelu (Workers AI / Claude API) a dostaň pole závodů podle schématu. Výstup validuj přes zod. Nevalidní položky zaloguj a přeskoč, celou dávku kvůli nim neshazuj.
4. Normalizuj: datum na ISO, disciplínu a úroveň na hodnoty z výčtu, místo na název obce.
5. Geokóduj přes cache.
6. Deduplikuj. `dedupe_key` = normalizované místo + datum začátku + disciplína. Stejný závod z více zdrojů je jeden řádek v `events` a víc řádků v `event_sources`. Při konfliktu má přednost Autoklub ČR.
7. Upsert. Závod, který ze zdroje zmizel, nemaž. Nech ho a označ až ručně.

Pro každý zdroj ulož vzorový stažený obsah do `fixtures/` a napiš test, který nad ním pustí normalizaci a deduplikaci bez volání API.

## Kontrola webů pořadatelů

Po každém stažení kalendářů (týdně) se ověří weby pořadatelů (`events.website_url`) u závodů v příštích 14 dnech, max. `ORGANIZER_CHECK_LIMIT` (výchozí 10) za běh, nejbližší a nejdéle neověřené první. Ručně přes `POST /admin/check-organizers`.

- Stránka se stahuje stejně jako zdroje (robots.txt, User-Agent, limit na doménu). Jen HTML; PDF a jiné typy se přeskočí.
- Model se volá jen když se text stránky od minulé kontroly změnil. Vrací pevné schéma (zmiňuje závod?, stav planned/cancelled/postponed, termín, krátká poznámka), výstup se validuje.
- Výsledek se ukládá do `organizer_checks`, ne do `events`: kalendářový import tak zrušení od pořadatele nepřepíše a změna termínu nevytvoří duplicitu. API zrušení od pořadatele promítá do stavu závodu, odklad a jiný termín ukazuje jako upozornění.
- Neukládá se text stránky ani osobní údaje, jen hash a strukturovaný výsledek.

## Pravidla pro stahování

- Respektuj robots.txt. Posílej vlastní User-Agent s kontaktem.
- Maximálně jeden požadavek za pár sekund na doménu, stahuj jednou týdně (pondělí 5:00). Když se obsah zdroje (u HTML text po očištění) od minula nezměnil, model se nevolá. Závody, které už skončily, se při každém běhu označí jako `finished`.
- U každého závodu zobraz odkaz na zdroj.
- Neukládej osobní údaje jezdců. Edda Cup má u závodů seznamy registrovaných jezdců, ty nestahuj.

## Frontend

- Výchozí pohled je seznam nadcházejících závodů seřazený podle data.
- Filtry: disciplína, úroveň, kraj, rozsah dat. Stav filtrů drž v URL, aby šel odkaz sdílet.
- Mapa ukazuje stejnou množinu jako seznam.
- Detail: všechna pole, odkazy na pořadatele a na všechny zdroje, čas poslední aktualizace.
- Musí fungovat na mobilu, uživatel se na to bude dívat hlavně venku u trati. Světlý a tmavý režim.
- Rozhraní česky.

## Pořadí práce

1. Schéma a migrace D1.
2. Pipeline pro Autoklub ČR od stažení po upsert, s fixtures a testy.
3. Minimální frontend se seznamem nad reálnými daty.
4. Autokaleidoskop a Edda Cup, deduplikace napříč zdroji.
5. Filtry, mapa, detail.
6. Cron Trigger a nasazení na Cloudflare (Workers + static assets).

Po každém kroku se zastav a ukaž, co funguje. Dál pokračuj až po odsouhlasení.

## Otevřené otázky

- Zeptat se Autoklubu ČR, jestli kalendář neposkytují ve strojově čitelné podobě. Pokud ano, extrakce přes model u tohoto zdroje odpadá.
- Zahrnout závody v zahraničí, které patří do českých seriálů, třeba vrchy v Rakousku? Návrh: ano, s příznakem země.
- Track days a volné jízdy na okruzích. Podle mě patří do druhé verze jako samostatná disciplína.
