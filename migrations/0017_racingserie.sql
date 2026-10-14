-- Racing Serie (Autoklub Bohemia Sport v AČR): amateur races on the asphalt
-- circuit of RacePark Milovice, a season from November to November (2025/26),
-- found on 2026-10-14 via Firecrawl (no robots.txt on the site).
-- https://racingserie.com/ redirects to the current season (/ars-25-26), so
-- next season is the same URL (rollover rule 1). The list of dates doesn't
-- name the place (only each race's page and the rules do): the name of the
-- source says it, the model takes the town from it like "Red Bull Ring → Spielberg".
-- The Facebook page (facebook.com/racingserie) has only two events from 2018,
-- so it is not added to the facebook sources.
-- Organizer's own calendar: priority next to the other series (22–30).
INSERT INTO sources (id, provider, name, url, season, kind, priority) VALUES
  ('racingserie-2026', 'racingserie', 'Racing Serie – závody na okruhu RacePark Milovice (obec Milovice)',
   'https://racingserie.com/', 2026, 'html', 28);
