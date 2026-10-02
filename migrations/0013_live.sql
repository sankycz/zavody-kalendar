-- Race-day view ("Živě ze závodu", the day before and while the race runs).
--
-- Links only: results and live timing stay on the services that publish them;
-- we store no results and no names (docs/SPEC.md, Živě ze závodu).

-- What the organizer's own website links to for this race (organizer check).
ALTER TABLE organizer_checks ADD COLUMN results_url TEXT;
ALTER TABLE organizer_checks ADD COLUMN stream_url TEXT;

-- Results services offered for a race by discipline and series. Edit rows to add
-- a service or change its address, no code change. `url` may contain {q}: the
-- race name and year, URL-encoded (for a service's search page).
CREATE TABLE live_services (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  url         TEXT NOT NULL CHECK (url LIKE 'https://%'),
  disciplines TEXT,                -- comma-separated disciplines, NULL = any
  name_like   TEXT,                -- LIKE pattern on the series or the race name, NULL = any
  position    INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

INSERT INTO live_services (id, label, url, disciplines, name_like, position) VALUES
  ('barum', 'Barum Czech Rally Zlín – výsledky', 'https://www.czechrally.com/en/rally-results', 'rally', '%Barum%', 0),
  ('cmpr', 'ČMPR – výsledky', 'https://cmpr.cz/vysledky/', 'rally,rallysprint', '%Českomoravsk%', 1),
  ('cmpr-abbr', 'ČMPR – výsledky', 'https://cmpr.cz/vysledky/', 'rally,rallysprint', '%ČMPR%', 1),
  ('rally-vysledky', 'Rally-výsledky.com', 'https://rally-vysledky.com/', 'rally,rallysprint', NULL, 2),
  ('ewrc', 'eWRC-results', 'https://www.ewrc-results.com/', 'rally,rallysprint,historic', NULL, 3),
  ('rallycross', 'Rallycross.cz – autokros online', 'https://www.rallycross.cz/', 'autocross', NULL, 2);
