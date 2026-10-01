-- Former dedupe keys of an event: after its place or date was corrected, or
-- after two duplicates were merged. A source that still reports the old key
-- (e.g. Autokaleidoskop's preliminary date of Rallye Železné hory) then
-- updates this event instead of creating the duplicate again.
CREATE TABLE event_aliases (
  dedupe_key TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE
);

CREATE INDEX event_aliases_event_id_idx ON event_aliases (event_id);
