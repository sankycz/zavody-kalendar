-- Facebook events as a source, fetched through the Apify actor
-- apify/facebook-events-scraper (needs the APIFY_TOKEN Worker secret).
-- `via` says how a source is fetched: 'web' = download `url`, 'facebook' =
-- run the actor; then `url` holds what to scrape, one entry per line (a
-- Facebook URL – page events tab, event, events search – or a search phrase).
-- `kind` stays the type of content for the model: Facebook events become text ('html').
-- (A new column instead of a new `kind` value: changing the CHECK would mean
-- rebuilding `sources`, which D1 refuses while event_sources references it.)
ALTER TABLE sources ADD COLUMN via TEXT NOT NULL DEFAULT 'web' CHECK (via IN ('web', 'facebook'));

-- Off until the organizers' pages are filled in and APIFY_TOKEN is set.
-- Lowest priority: organizer sites and calendars win on conflicts.
INSERT INTO sources (id, provider, name, url, season, kind, via, priority, enabled) VALUES
  ('facebook-2026', 'facebook', 'Facebook – události pořadatelů',
   'autoslalom
závod do vrchu
rallysprint
autokros', 2026, 'html', 'facebook', 90, 0);
