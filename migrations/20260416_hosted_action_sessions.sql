CREATE TABLE IF NOT EXISTS hosted_action_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  audience TEXT,
  auth_type TEXT,
  resume_url TEXT,
  resume_token_hash TEXT NOT NULL UNIQUE,
  display_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('pending', 'completed', 'failed', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_hosted_action_sessions_merchant_created
  ON hosted_action_sessions(merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hosted_action_sessions_status_expires
  ON hosted_action_sessions(status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_hosted_action_sessions_entity_created
  ON hosted_action_sessions(entity_type, entity_id, created_at DESC);
