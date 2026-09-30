-- The calendar lists races in the Czech Republic only. The geocoder now stores
-- the country where a place was found, so a race the model marked CZ but
-- whose place is abroad (e.g. Annaberg-Buchholz) can be recognized.
ALTER TABLE locations ADD COLUMN country TEXT; -- ISO alpha-2 of the place, NULL for misses

-- Rows cached before this column: lookups were restricted to CZ first, so a
-- Czech region name means the place is in CZ. Other hits came from the
-- neighbor fallback: forget them (and the events' points) so /admin/geocode
-- looks them up again and records their country.
UPDATE locations SET country = 'CZ'
WHERE found = 1 AND region IN (
  'Hlavní město Praha', 'Jihočeský kraj', 'Jihomoravský kraj', 'Karlovarský kraj', 'Královéhradecký kraj',
  'Liberecký kraj', 'Moravskoslezský kraj', 'Olomoucký kraj', 'Pardubický kraj', 'Plzeňský kraj',
  'Středočeský kraj', 'Ústecký kraj', 'Kraj Vysočina', 'Zlínský kraj'
);

UPDATE events SET lat = NULL, lng = NULL, region = NULL
WHERE location_name || ', ' || country IN (SELECT query FROM locations WHERE found = 1 AND country IS NULL);

DELETE FROM locations WHERE found = 1 AND country IS NULL;
