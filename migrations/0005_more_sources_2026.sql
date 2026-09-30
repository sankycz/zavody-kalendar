-- More sources for season 2026 (priorities as in 0004: organizers 20–39, circuits 40–59).
-- Checked via Apify on 2026-09-30. Left out on purpose:
--   Maverick Hill Climb (maverickrescue.cz) – the 2026 calendar is only an image,
--   Carbonia Cup (carboniacup.cz) – every page carries rider standings (personal data),
--   AmaterCup (amatercup.cz) – calendar page 404 / rendered only by JavaScript,
--   autosport.cz – no calendar page, motolevel.com – motorcycles.
-- Circuit calendars (Most, Brno) list only upcoming weeks; the daily cron picks
-- up new months as they appear and never deletes what it saw before.
INSERT INTO sources (id, provider, name, url, season, kind, priority) VALUES
  ('cmpr-2026',               'cmpr',               'Českomoravský pohár rallye – kalendář',
   'https://cmpr.cz/souteze-poharu/', 2026, 'html', 22),
  ('triola-2026',             'triola',             'Triola Cup – kalendář',
   'http://www.triola-cup.cz/kalendar/', 2026, 'html', 24),
  ('krusnohorsky-pohar-2026', 'krusnohorsky-pohar', 'Krušnohorský pohár – kalendář',
   'https://www.krusnohorskypohar.cz/index.php/2025/12/01/kalendar-2026/', 2026, 'html', 26),
  ('autodrom-most-2026',      'autodrom-most',      'Autodrom Most – kalendář závodů',
   'https://www.autodrom-most.cz/kalendar-zavodu-c1423/', 2026, 'html', 40),
  ('automotodrom-brno-2026',  'automotodrom-brno',  'Autodrom Brno – kalendář akcí',
   'https://www.automotodrombrno.cz/kalendar-akci/', 2026, 'html', 42);
