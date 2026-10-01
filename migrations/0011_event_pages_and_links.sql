-- Organizer pages of a single race, and documents for spectators.
--
-- `scope`: 'calendar' = a page listing races (every source so far);
-- 'event' = the organizer's page of one race. Such a page often doesn't
-- repeat the date or place (they are on the poster), so an item without them
-- is attached by name to a race of the same season that a calendar already
-- knows (src/pipeline/eventPage.ts) instead of being skipped.
ALTER TABLE sources ADD COLUMN scope TEXT NOT NULL DEFAULT 'calendar' CHECK (scope IN ('calendar', 'event'));

-- Links from a source to documents for spectators (schedule, map, spectator
-- areas, regulations, poster). Never start lists or lists of crews (personal
-- data), never entry forms (no registrations in v1) – see normalizeLinks().
-- Each source replaces its own links of an event on every run.
CREATE TABLE event_links (
  event_id  TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources (id),
  url       TEXT NOT NULL,
  label     TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('harmonogram', 'mapa', 'divaci', 'propozice', 'plakat', 'video', 'jine')),
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, url)
);

CREATE INDEX event_links_source_id_idx ON event_links (source_id);

-- KBS Sedliště: XI. Podbrdské setkání legend (rally of historic cars near
-- Nepomuk). The page has schedule, maps and regulations but no date (it is on
-- the poster), so it enriches the race found by the calendars / Facebook.
-- An organizer's own page: wins over the general calendars, not over Autoklub ČR.
INSERT INTO sources (id, provider, name, url, season, kind, priority, scope) VALUES
  ('kbssped-2026', 'kbssped', 'KBS Sedliště – Podbrdské setkání legend',
   'https://www.kbssped.cz/?page_id=34', 2026, 'html', 20, 'event');

-- The race itself (with date and place) is on the organizer's Facebook page.
UPDATE sources SET url = url || char(10) || 'https://www.facebook.com/podbrdskesetkanilegend.cz/events'
WHERE provider = 'facebook' AND url NOT LIKE '%podbrdskesetkanilegend%';
