-- Facebook events as a source, fetched through the Apify actor
-- apify/facebook-events-scraper (needs the APIFY_TOKEN Worker secret).
-- For kind 'facebook', `url` holds what to scrape, one entry per line:
-- a Facebook URL (page events tab, event, events search) or a search phrase.
-- SQLite can't change a CHECK constraint, so the table is rebuilt
-- (D1 runs a migration in one transaction; foreign keys are checked at the end).
PRAGMA defer_foreign_keys = true;

CREATE TABLE sources_new (
  id                TEXT PRIMARY KEY,
  provider          TEXT NOT NULL,
  name              TEXT NOT NULL,
  url               TEXT NOT NULL,
  season            INTEGER NOT NULL CHECK (season BETWEEN 2000 AND 2100),
  kind              TEXT NOT NULL CHECK (kind IN ('html', 'pdf', 'facebook')),
  priority          INTEGER NOT NULL DEFAULT 100,
  last_fetched_at   TEXT,
  last_content_hash TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  UNIQUE (provider, season, kind)
);

INSERT INTO sources_new (id, provider, name, url, season, kind, priority, last_fetched_at, last_content_hash, enabled)
SELECT id, provider, name, url, season, kind, priority, last_fetched_at, last_content_hash, enabled FROM sources;

DROP TABLE sources;
ALTER TABLE sources_new RENAME TO sources;

-- Off until the organizers' pages are filled in and APIFY_TOKEN is set.
-- Lowest priority: an aggregator of posts, organizer sites and calendars win on conflicts.
INSERT INTO sources (id, provider, name, url, season, kind, priority, enabled) VALUES
  ('facebook-2026', 'facebook', 'Facebook – události pořadatelů',
   'autoslalom
závod do vrchu
rallysprint
autokros', 2026, 'facebook', 90, 0);
