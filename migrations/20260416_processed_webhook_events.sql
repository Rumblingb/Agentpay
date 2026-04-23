-- Replay guard for third-party webhook deliveries.
-- Purpose:
--   1. Deduplicate Stripe webhook event processing across retries.
--   2. Keep side effects first-write wins even when the provider replays.

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  provider     text NOT NULL,
  event_id     text NOT NULL,
  event_type   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_processed_webhook_events_created
  ON processed_webhook_events (created_at DESC);
