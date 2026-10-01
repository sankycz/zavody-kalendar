-- Autoklub ČR's own events database ("Kalendář podniků", sport Automobily):
-- live data incl. cancellations ("– ZRUŠENO"), 15 events per page.
-- `max_pages`: how many "next page" links a source may follow (paging.ts).
ALTER TABLE sources ADD COLUMN max_pages INTEGER NOT NULL DEFAULT 1 CHECK (max_pages BETWEEN 1 AND 20);

-- Highest priority: the federation's live database wins over its own article
-- and PDF (11, 10) and over everyone else. The listing has no places; the
-- model takes them from the event names, events without a place are skipped
-- (the other sources still cover them). The dates in the URL are swapped by
-- the season rollover (2026 → 2027).
INSERT INTO sources (id, provider, name, url, season, kind, priority, max_pages) VALUES
  ('autoklub-podniky-2026', 'autoklub-podniky', 'Autoklub ČR – kalendář podniků',
   'https://www.autoklub.cz/ostatni/kalendar-podniku/?id_sport=1212&termin_od=01.01.2026&termin_do=31.12.2026',
   2026, 'html', 9, 10);
