-- Stages (RZ) of a race and when their roads are closed, read by the model from
-- the organizer's documents for spectators (src/pipeline/stages.ts). Navigation
-- apps don't know the closures; the race detail lists them only when a document
-- gives them. Only stage names and times, never names of people.

-- Last reading of a race's documents (one row per race).
CREATE TABLE stage_checks (
  event_id     TEXT PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
  checked_at   TEXT NOT NULL,
  -- Hash of the documents read; the model runs again only when they change.
  content_hash TEXT,
  -- The document the stages below come from, NULL when none had any.
  doc_url      TEXT,
  error        TEXT
);

-- One row per run of a stage (RZ 1, RZ 2…), replaced on every reading that changed.
CREATE TABLE event_stages (
  event_id    TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  name        TEXT NOT NULL,
  date        TEXT CHECK (date IS NULL OR date IS date(date)),
  first_car   TEXT CHECK (first_car IS NULL OR first_car GLOB '[0-2][0-9]:[0-5][0-9]'),
  closed_from TEXT CHECK (closed_from IS NULL OR closed_from GLOB '[0-2][0-9]:[0-5][0-9]'),
  closed_to   TEXT CHECK (closed_to IS NULL OR closed_to GLOB '[0-2][0-9]:[0-5][0-9]'),
  length_km   REAL,
  PRIMARY KEY (event_id, position)
);
