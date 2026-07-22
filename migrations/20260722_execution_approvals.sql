-- Bind governed execution to the exact server-created action payload.
-- Approval confirmation and execution claim are separate; execution is one-time
-- and completed responses are retained for idempotent client retry.

ALTER TABLE approval_events
  ADD COLUMN IF NOT EXISTS approval_token_hash text,
  ADD COLUMN IF NOT EXISTS policy_version text,
  ADD COLUMN IF NOT EXISTS action_kind text,
  ADD COLUMN IF NOT EXISTS action_payload_hash text,
  ADD COLUMN IF NOT EXISTS action_payload_json jsonb,
  ADD COLUMN IF NOT EXISTS execution_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS execution_result_json jsonb,
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

CREATE INDEX IF NOT EXISTS approval_events_execution_status_idx
  ON approval_events (execution_status, expires_at DESC);

CREATE INDEX IF NOT EXISTS approval_events_action_payload_hash_idx
  ON approval_events (action_payload_hash)
  WHERE action_payload_hash IS NOT NULL;
