-- Initial schema (Cloudflare D1 / SQLite): sources, events, event_sources, locations.
-- The database is never exposed directly: the frontend reads through a
-- read-only Worker API, only the ingest Worker writes.
-- Dates are ISO 'YYYY-MM-DD' text, timestamps ISO 8601 UTC text, booleans 0/1.

-- ---------------------------------------------------------------------------
-- sources: one row per provider + season + document (HTML/PDF).
-- A new season is added as a new row, no code change needed.
-- ---------------------------------------------------------------------------
CREATE TABLE sources (
  id                TEXT PRIMARY KEY,           -- e.g. 'autoklub-cal-pdf-2026'
  provider          TEXT NOT NULL,              -- e.g. 'autoklub-cal', 'autokaleidoskop', 'edda'
  name              TEXT NOT NULL,              -- human-readable name shown in UI
  url               TEXT NOT NULL,
  season            INTEGER NOT NULL CHECK (season BETWEEN 2000 AND 2100),
  kind              TEXT NOT NULL CHECK (kind IN ('html', 'pdf')),
  priority          INTEGER NOT NULL DEFAULT 100, -- lower wins on field conflicts (Autoklub ČR = 10)
  last_fetched_at   TEXT,
  last_content_hash TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  UNIQUE (provider, season, kind)
);

-- ---------------------------------------------------------------------------
-- events: one row per real-world race, deduplicated across sources.
-- ---------------------------------------------------------------------------
CREATE TABLE events (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name          TEXT NOT NULL,
  date_from     TEXT NOT NULL CHECK (date_from IS date(date_from)),
  date_to       TEXT CHECK (date_to IS NULL OR (date_to IS date(date_to) AND date_to >= date_from)),
  discipline    TEXT NOT NULL CHECK (discipline IN (
                  'rally', 'rallysprint', 'vrch', 'autocross', 'slalom',
                  'okruh', 'drift', 'regularity', 'historic', 'jiny')),
  series        TEXT,
  level         TEXT NOT NULL CHECK (level IN ('mcr', 'pohar', 'regionalni', 'volny')),
  location_name TEXT,
  region        TEXT,                           -- kraj
  lat           REAL CHECK (lat BETWEEN -90 AND 90),
  lng           REAL CHECK (lng BETWEEN -180 AND 180),
  country       TEXT NOT NULL DEFAULT 'CZ' CHECK (length(country) = 2 AND country = upper(country)),
  organizer     TEXT,
  website_url   TEXT,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'cancelled', 'finished')),
  dedupe_key    TEXT NOT NULL UNIQUE,           -- normalized location | date_from | discipline
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX events_date_from_idx  ON events (date_from);
CREATE INDEX events_discipline_idx ON events (discipline);
CREATE INDEX events_level_idx      ON events (level);
CREATE INDEX events_region_idx     ON events (region);

CREATE TRIGGER events_set_updated_at
AFTER UPDATE ON events
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE events SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- ---------------------------------------------------------------------------
-- event_sources: which source reported which event.
-- last_seen_at lets an admin spot events that disappeared from a source
-- (they are never deleted automatically).
-- ---------------------------------------------------------------------------
CREATE TABLE event_sources (
  event_id      TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  source_id     TEXT NOT NULL REFERENCES sources (id),
  source_url    TEXT NOT NULL,
  raw_excerpt   TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (event_id, source_id)
);

CREATE INDEX event_sources_source_id_idx ON event_sources (source_id);

-- ---------------------------------------------------------------------------
-- locations: Nominatim geocoding cache.
-- ---------------------------------------------------------------------------
CREATE TABLE locations (
  query      TEXT PRIMARY KEY,
  lat        REAL,
  lng        REAL,
  region     TEXT,
  found      INTEGER NOT NULL DEFAULT 1 CHECK (found IN (0, 1)), -- 0 = Nominatim returned nothing, don't retry every run
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- Seed: sources for season 2026
-- ---------------------------------------------------------------------------
INSERT INTO sources (id, provider, name, url, season, kind, priority) VALUES
  ('autoklub-cal-pdf-2026',  'autoklub-cal',    'Autoklub ČR – kalendář (PDF)',
   'https://www.autoklub.cz/wp-content/uploads/2026/01/cal-predbezny-26-v6.pdf', 2026, 'pdf', 10),
  ('autoklub-cal-html-2026', 'autoklub-cal',    'Autoklub ČR – kalendář',
   'https://www.autoklub.cz/205368-kalendar-automobiloveho-sportu-acr-2026/', 2026, 'html', 11),
  ('autokaleidoskop-2026',   'autokaleidoskop', 'Autokaleidoskop – kalendář závodů',
   'https://www.autokaleidoskop.cz/Kalendar/AKTUALIZACE:-Kalendar-automobilovych-zavodu-v-CR-2026/', 2026, 'html', 50),
  ('edda-2026',              'edda',            'Edda Cup – tratě',
   'http://www.edda.cz/mscrdovrchu/index.php?m=trate', 2026, 'html', 60);
