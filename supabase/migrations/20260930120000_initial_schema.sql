-- Initial schema: sources, events, event_sources, locations.
-- Public (anon) can only read events and their source links.
-- All writes go through the ingest edge function using service_role.

-- ---------------------------------------------------------------------------
-- sources: one row per provider + season + document (HTML/PDF).
-- A new season is added as a new row, no code change needed.
-- ---------------------------------------------------------------------------
create table public.sources (
  id                text primary key,          -- e.g. 'autoklub-cal-pdf-2026'
  provider          text not null,             -- e.g. 'autoklub-cal', 'autokaleidoskop', 'edda'
  name              text not null,             -- human-readable name shown in UI
  url               text not null,
  season            int  not null check (season between 2000 and 2100),
  kind              text not null check (kind in ('html', 'pdf')),
  priority          int  not null default 100, -- lower wins on field conflicts (Autoklub ČR = 10)
  last_fetched_at   timestamptz,
  last_content_hash text,
  enabled           boolean not null default true,
  unique (provider, season, kind)
);

-- ---------------------------------------------------------------------------
-- events: one row per real-world race, deduplicated across sources.
-- ---------------------------------------------------------------------------
create table public.events (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  date_from     date not null,
  date_to       date,
  discipline    text not null check (discipline in (
                  'rally', 'rallysprint', 'vrch', 'autocross', 'slalom',
                  'okruh', 'drift', 'regularity', 'historic', 'jiny')),
  series        text,
  level         text not null check (level in ('mcr', 'pohar', 'regionalni', 'volny')),
  location_name text,
  region        text,                           -- kraj
  lat           double precision check (lat between -90 and 90),
  lng           double precision check (lng between -180 and 180),
  country       text not null default 'CZ' check (country ~ '^[A-Z]{2}$'),
  organizer     text,
  website_url   text,
  description   text,
  status        text not null default 'planned' check (status in ('planned', 'cancelled', 'finished')),
  dedupe_key    text not null unique,           -- normalized location | date_from | discipline
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (date_to is null or date_to >= date_from)
);

create index events_date_from_idx on public.events (date_from);
create index events_discipline_idx on public.events (discipline);
create index events_level_idx on public.events (level);
create index events_region_idx on public.events (region);

-- ---------------------------------------------------------------------------
-- event_sources: which source reported which event.
-- last_seen_at lets an admin spot events that disappeared from a source
-- (they are never deleted automatically).
-- ---------------------------------------------------------------------------
create table public.event_sources (
  event_id      uuid not null references public.events(id) on delete cascade,
  source_id     text not null references public.sources(id),
  source_url    text not null,
  raw_excerpt   text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (event_id, source_id)
);

create index event_sources_source_id_idx on public.event_sources (source_id);

-- ---------------------------------------------------------------------------
-- locations: Nominatim geocoding cache. Internal only.
-- ---------------------------------------------------------------------------
create table public.locations (
  query      text primary key,
  lat        double precision,
  lng        double precision,
  region     text,
  found      boolean not null default true,     -- false = Nominatim returned nothing, don't retry every run
  fetched_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at trigger for events
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger events_set_updated_at
before update on public.events
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on public.sources, public.events, public.event_sources, public.locations
  from anon, authenticated;

grant select on public.sources, public.events, public.event_sources to anon, authenticated;

grant all on public.sources, public.events, public.event_sources, public.locations
  to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- service_role bypasses RLS; no write policies for anon/authenticated.
-- ---------------------------------------------------------------------------
alter table public.sources       enable row level security;
alter table public.events        enable row level security;
alter table public.event_sources enable row level security;
alter table public.locations     enable row level security;

create policy "events are public"
  on public.events for select
  to anon, authenticated
  using (true);

create policy "event sources are public"
  on public.event_sources for select
  to anon, authenticated
  using (true);

create policy "sources are public"
  on public.sources for select
  to anon, authenticated
  using (true);

-- locations: no policies -> not reachable by anon/authenticated.

-- ---------------------------------------------------------------------------
-- Seed: sources for season 2026
-- ---------------------------------------------------------------------------
insert into public.sources (id, provider, name, url, season, kind, priority) values
  ('autoklub-cal-pdf-2026',  'autoklub-cal',    'Autoklub ČR – kalendář (PDF)',
   'https://www.autoklub.cz/wp-content/uploads/2026/01/cal-predbezny-26-v6.pdf', 2026, 'pdf', 10),
  ('autoklub-cal-html-2026', 'autoklub-cal',    'Autoklub ČR – kalendář',
   'https://www.autoklub.cz/205368-kalendar-automobiloveho-sportu-acr-2026/', 2026, 'html', 11),
  ('autokaleidoskop-2026',   'autokaleidoskop', 'Autokaleidoskop – kalendář závodů',
   'https://www.autokaleidoskop.cz/Kalendar/AKTUALIZACE:-Kalendar-automobilovych-zavodu-v-CR-2026/', 2026, 'html', 50),
  ('edda-2026',              'edda',            'Edda Cup – tratě',
   'http://www.edda.cz/mscrdovrchu/index.php?m=trate', 2026, 'html', 60);
