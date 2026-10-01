-- Next season without code changes (src/pipeline/rollover.ts): every run looks
-- for next year's calendar of each source. `index_url` is the page where a
-- source's new calendar gets linked when its own URL can't simply be reused
-- (it contains the year and the new one isn't at the same address with the year changed).
ALTER TABLE sources ADD COLUMN index_url TEXT;

-- Autoklub ČR publishes the calendar as a news article (2026: 2. 2. 2026);
-- the PDF is then looked up in next year's article.
UPDATE sources SET index_url = 'https://www.autoklub.cz/motorsport/automobily/aktuality/'
WHERE id = 'autoklub-cal-html-2026';

UPDATE sources SET index_url = 'https://www.autokaleidoskop.cz/Kalendar/'
WHERE id = 'autokaleidoskop-2026';

-- The source URL is a dated post (/2025/12/01/kalendar-2026/); the home page
-- links /index.php/kalendar-YYYY/ for each season.
UPDATE sources SET index_url = 'https://www.krusnohorskypohar.cz/'
WHERE id = 'krusnohorsky-pohar-2026';
