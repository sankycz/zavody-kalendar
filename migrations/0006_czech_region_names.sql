-- Geocoder switched to Open-Meteo (GeoNames), which returns some Czech regions
-- without the word "kraj" ("Karlovarský"). Rename them to the official names
-- ("Karlovarský kraj") so the region filter groups them. New lookups are
-- normalized in geocode.ts (czechRegion).
UPDATE locations SET region = CASE region WHEN 'Vysočina' THEN 'Kraj Vysočina' ELSE region || ' kraj' END
WHERE query LIKE '%, CZ' AND region IN (
  'Jihočeský', 'Jihomoravský', 'Karlovarský', 'Královéhradecký', 'Liberecký', 'Moravskoslezský',
  'Olomoucký', 'Pardubický', 'Plzeňský', 'Středočeský', 'Ústecký', 'Vysočina', 'Zlínský'
);

UPDATE events SET region = CASE region WHEN 'Vysočina' THEN 'Kraj Vysočina' ELSE region || ' kraj' END
WHERE region IN (
  'Jihočeský', 'Jihomoravský', 'Karlovarský', 'Královéhradecký', 'Liberecký', 'Moravskoslezský',
  'Olomoucký', 'Pardubický', 'Plzeňský', 'Středočeský', 'Ústecký', 'Vysočina', 'Zlínský'
);
