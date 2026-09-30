-- updated_at should mean "the data changed", not "the daily ingest touched the row".
-- The daily upsert rewrites every matched event, so bump updated_at only when a
-- user-visible column actually changed.
DROP TRIGGER events_set_updated_at;

CREATE TRIGGER events_set_updated_at
AFTER UPDATE ON events
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at AND (
     NEW.name          IS NOT OLD.name
  OR NEW.date_from     IS NOT OLD.date_from
  OR NEW.date_to       IS NOT OLD.date_to
  OR NEW.discipline    IS NOT OLD.discipline
  OR NEW.series        IS NOT OLD.series
  OR NEW.level         IS NOT OLD.level
  OR NEW.location_name IS NOT OLD.location_name
  OR NEW.region        IS NOT OLD.region
  OR NEW.lat           IS NOT OLD.lat
  OR NEW.lng           IS NOT OLD.lng
  OR NEW.country       IS NOT OLD.country
  OR NEW.organizer     IS NOT OLD.organizer
  OR NEW.website_url   IS NOT OLD.website_url
  OR NEW.description   IS NOT OLD.description
  OR NEW.status        IS NOT OLD.status
)
BEGIN
  UPDATE events SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
