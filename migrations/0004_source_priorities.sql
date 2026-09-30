-- Source priorities (lower wins when two sources report the same race):
--   10–19  Autoklub ČR (official calendar)
--   20–39  the series organizer's own website (Edda Cup, …)
--   40–59  circuit operators
--   70+    aggregators and magazines (Autokaleidoskop, …)
-- The organizer knows its own dates better than a magazine copying them.
UPDATE sources SET priority = 30 WHERE id = 'edda-2026';
UPDATE sources SET priority = 70 WHERE id = 'autokaleidoskop-2026';
