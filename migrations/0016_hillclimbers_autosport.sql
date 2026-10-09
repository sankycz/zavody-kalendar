-- Two more aggregators for season 2026, found via Firecrawl on 2026-10-09
-- (robots.txt of both allows the pages). Priorities as in 0004: 70+ aggregators.
--   hillclimbers.eu – hill climbs in CZ (MČR, Maverick Hill Climb Czech), which
--     covers the Maverick calendar left out in 0005 (there only an image).
--     The season is in the URL, next year is ?year=2027 (rollover rule 2).
--   autosport.cz – "Přehled závodů": MČR, RSS and smaller rallies (BOAS, Rallye
--     Jizera…). Not in 0005 because the page wasn't found then. The current
--     season is always at the same URL (rollover rule 1). Foreign rallies on
--     the page are skipped by the model and by country.
INSERT INTO sources (id, provider, name, url, season, kind, priority) VALUES
  ('hillclimbers-2026', 'hillclimbers', 'Hillclimbers.eu – kalendář závodů do vrchu',
   'https://hillclimbers.eu/kalendar?year=2026&country=CZ', 2026, 'html', 72),
  ('autosport-2026',    'autosport',    'Autosport.cz – přehled závodů',
   'http://www.autosport.cz/souteze/vsechny.php', 2026, 'html', 74);
