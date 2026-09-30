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

URL obsahují rok. Kalendář na další sezónu vychází v zimě, předběžný kalendář 2026 vyšel 28. 1. 2026. Konfigurace zdrojů proto musí umět URL pro nový rok přidat bez změny kódu.

## Architektura

- **Databáze:** Supabase Postgres.
- **Stahování:** Supabase Edge Function v Deno, spouštěná přes pg_cron jednou týdně a ručně přes admin endpoint.
- **Extrakce:** Claude API. Stažený HTML text nebo text z PDF pošli modelu s pevným JSON schématem a nech ho vrátit pole závodů. Parser pro každý web zvlášť nepiš, zdroje se mění a jsou nekonzistentní. Model si vezmi z proměnné prostředí `CLAUDE_MODEL`.
- **Geokódování:** Nominatim z OpenStreetMap, maximálně 1 požadavek za sekundu, výsledky cachuj v tabulce `locations`.
- **Frontend:** Vite, React, TypeScript strict, Tailwind. Mapa přes Leaflet s OSM dlaždicemi.
- **Hosting frontendu:** Netlify.

Klíče patří do Supabase secrets a Netlify env proměnných. `ANTHROPIC_API_KEY` nikdy nesmí skončit ve frontendu.

## Datový model

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
2. Z PDF vytáhni text, z HTML odstraň navigaci a patičku.
3. Pošli text do Claude API a dostaň pole závodů podle schématu. Výstup validuj přes zod. Nevalidní položky zaloguj a přeskoč, celou dávku kvůli nim neshazuj.
4. Normalizuj: datum na ISO, disciplínu a úroveň na hodnoty z výčtu, místo na název obce.
5. Geokóduj přes cache.
6. Deduplikuj. `dedupe_key` = normalizované místo + datum začátku + disciplína. Stejný závod z více zdrojů je jeden řádek v `events` a víc řádků v `event_sources`. Při konfliktu má přednost Autoklub ČR.
7. Upsert. Závod, který ze zdroje zmizel, nemaž. Nech ho a označ až ručně.

Pro každý zdroj ulož vzorový stažený obsah do `fixtures/` a napiš test, který nad ním pustí normalizaci a deduplikaci bez volání API.

## Pravidla pro stahování

- Respektuj robots.txt. Posílej vlastní User-Agent s kontaktem.
- Maximálně jeden požadavek za pár sekund na doménu, stahuj jednou týdně.
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

1. Supabase schéma a migrace.
2. Pipeline pro Autoklub ČR od stažení po upsert, s fixtures a testy.
3. Minimální frontend se seznamem nad reálnými daty.
4. Autokaleidoskop a Edda Cup, deduplikace napříč zdroji.
5. Filtry, mapa, detail.
6. pg_cron a nasazení na Vercel.

Po každém kroku se zastav a ukaž, co funguje. Dál pokračuj až po odsouhlasení.

## Otevřené otázky

- Zeptat se Autoklubu ČR, jestli kalendář neposkytují ve strojově čitelné podobě. Pokud ano, extrakce přes model u tohoto zdroje odpadá.
- Zahrnout závody v zahraničí, které patří do českých seriálů, třeba vrchy v Rakousku? Návrh: ano, s příznakem země.
- Track days a volné jízdy na okruzích. Podle mě patří do druhé verze jako samostatná disciplína.
- Hosting: architektura říká Netlify, pořadí práce v kroku 6 Vercel — rozhodnout jeden.
