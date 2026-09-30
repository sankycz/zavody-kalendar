-- Daily check of organizer websites for upcoming events.
-- Kept apart from `events` on purpose: the calendar ingest keeps writing events,
-- this table only overlays what the organizer's own page says (cancelled,
-- postponed, different dates). The page text itself is never stored.
CREATE TABLE organizer_checks (
  event_id     TEXT PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  checked_at   TEXT NOT NULL,                  -- last attempt (ISO UTC)
  content_hash TEXT,                           -- hash of the page text at the last model call
  outcome      TEXT NOT NULL CHECK (outcome IN ('confirmed', 'changed', 'not_mentioned', 'error')),
  status       TEXT CHECK (status IN ('planned', 'cancelled', 'postponed')),
  date_from    TEXT CHECK (date_from IS NULL OR date_from IS date(date_from)),
  date_to      TEXT CHECK (date_to IS NULL OR date_to IS date(date_to)),
  notice       TEXT,                           -- short factual note from the page, no personal data
  error        TEXT,                           -- last fetch / extraction error, findings above are kept
  changed_at   TEXT                            -- when status / dates / notice last changed
);

CREATE INDEX organizer_checks_checked_at_idx ON organizer_checks (checked_at);
