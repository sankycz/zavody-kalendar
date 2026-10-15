-- Race tracks: where a race in a town actually is. Geocoding knows only the
-- town (GeoNames gives its centre), so "Navigovat" led to the middle of
-- Milovice instead of RacePark on the former airfield. A race whose town and
-- discipline match a row here gets the track's point (API, map, navigation).
-- Only tracks whose position is certain: a wrong track is worse than the town.
-- Points are from OpenStreetMap (via Photon), checked on 2026-10-15; the area of
-- the track, or its entrance where the area is a closed circuit in a forest.
CREATE TABLE venues (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  -- Town exactly as in events.location_name.
  location_name TEXT NOT NULL,
  -- Comma-separated disciplines raced there (a town can have a circuit and a
  -- slalom on a car park elsewhere).
  disciplines   TEXT NOT NULL,
  lat           REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng           REAL NOT NULL CHECK (lng BETWEEN -180 AND 180)
);

CREATE INDEX venues_location_idx ON venues (location_name);

INSERT INTO venues (id, name, location_name, disciplines, lat, lng) VALUES
  -- Jiřická 1999 (address given by the organizers), on the former airfield Boží Dar.
  ('racepark-milovice', 'RacePark Milovice', 'Milovice', 'okruh,drift', 50.24839, 14.85560),
  ('autodrom-most', 'Autodrom Most', 'Most', 'okruh', 50.51822, 13.59791),
  -- Bus stop at the main entrance on Ostrovačická, the track itself is in the forest.
  ('masarykuv-okruh', 'Masarykův okruh', 'Brno', 'okruh', 49.20486, 16.44740),
  ('autodrom-sosnova', 'Autodrom Sosnová', 'Sosnová', 'okruh,autocross', 50.65977, 14.53837),
  ('autodrom-vysoke-myto', 'Autodrom Vysoké Mýto', 'Vysoké Mýto', 'slalom,jiny', 49.93757, 16.17147),
  ('autokros-humpolec', 'Autokros Humpolec', 'Humpolec', 'autocross', 49.53799, 15.37404),
  ('autokros-sedlcany', 'Autokros Sedlčanská kotlina', 'Sedlčany', 'autocross', 49.67012, 14.42803),
  ('autokros-prerov', 'Autokrosové závodiště Přerov', 'Přerov', 'autocross', 49.48438, 17.43021),
  ('autokros-stikov', 'Autokros Štikov', 'Nová Paka', 'autocross', 50.48839, 15.54050);
