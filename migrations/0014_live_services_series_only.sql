-- Results services that are not tied to a series (eWRC, Rally-výsledky.com,
-- Rallycross.cz) open on their home page, not on the race's results: no use in
-- the race-day view. Only series-specific ones stay (ČMPR, Barum); otherwise the
-- view shows the organizer's own results link or nothing.
UPDATE live_services SET enabled = 0 WHERE name_like IS NULL;
