-- Trip Rooms: shared live journey for family/group travel
-- Created: 2026-03-26
--
-- A trip room is auto-created when a group booking is confirmed.
-- share_token is a short 8-char URL-safe token for the joinable web view.
-- members is a JSONB array: [{ name, pushToken, role, joinedAt }]
-- All disruption push alerts (cancel/delay/platform) fan out to all members.

CREATE TABLE IF NOT EXISTS trip_rooms (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid        NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  share_token  text        NOT NULL UNIQUE,
  members      jsonb       NOT NULL DEFAULT '[]',
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_rooms_job_id_idx    ON trip_rooms (job_id);
CREATE INDEX IF NOT EXISTS trip_rooms_share_token_idx ON trip_rooms (share_token);
CREATE INDEX IF NOT EXISTS trip_rooms_expires_at_idx  ON trip_rooms (expires_at);

-- Auto-expire: rows older than 48h can be cleaned up by a cron.
-- For now, the GET /trip/:token endpoint checks expires_at and returns 410.
