-- Capability vault slice
-- Generic merchant-scoped vault entries, connect sessions, access logs, and usage events.

CREATE TABLE IF NOT EXISTS capability_vault_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  capability_key TEXT NOT NULL,
  capability_type TEXT NOT NULL,
  capability_scope TEXT,
  provider TEXT,
  subject_type TEXT,
  subject_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  secret_payload_json JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT capability_vault_entries_unique_key UNIQUE (merchant_id, capability_key)
);

CREATE INDEX IF NOT EXISTS idx_capability_vault_entries_merchant_status
  ON capability_vault_entries (merchant_id, status);

CREATE INDEX IF NOT EXISTS idx_capability_vault_entries_type_status
  ON capability_vault_entries (capability_type, status);

CREATE INDEX IF NOT EXISTS idx_capability_vault_entries_expires
  ON capability_vault_entries (expires_at);

CREATE TABLE IF NOT EXISTS capability_connect_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  capability_vault_entry_id UUID NOT NULL REFERENCES capability_vault_entries(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  session_state TEXT NOT NULL DEFAULT 'pending',
  provider TEXT,
  redirect_url TEXT,
  callback_url TEXT,
  connection_payload_json JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  connected_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capability_connect_sessions_merchant_created
  ON capability_connect_sessions (merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_capability_connect_sessions_entry_state
  ON capability_connect_sessions (capability_vault_entry_id, session_state);

CREATE INDEX IF NOT EXISTS idx_capability_connect_sessions_state_expires
  ON capability_connect_sessions (session_state, expires_at);

CREATE TABLE IF NOT EXISTS capability_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  capability_vault_entry_id UUID REFERENCES capability_vault_entries(id) ON DELETE SET NULL,
  session_id UUID REFERENCES capability_connect_sessions(id) ON DELETE SET NULL,
  capability_key TEXT NOT NULL,
  capability_type TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'allowed',
  actor_type TEXT,
  actor_ref TEXT,
  request_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  reason_code TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capability_access_logs_merchant_created
  ON capability_access_logs (merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_capability_access_logs_entry_created
  ON capability_access_logs (capability_vault_entry_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_capability_access_logs_action_created
  ON capability_access_logs (action, created_at DESC);

CREATE TABLE IF NOT EXISTS capability_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  capability_vault_entry_id UUID REFERENCES capability_vault_entries(id) ON DELETE SET NULL,
  session_id UUID REFERENCES capability_connect_sessions(id) ON DELETE SET NULL,
  capability_key TEXT NOT NULL,
  capability_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  request_id TEXT,
  tool_name TEXT,
  usage_units INT NOT NULL DEFAULT 1,
  unit_price_micros INT NOT NULL DEFAULT 0,
  estimated_amount_micros INT NOT NULL DEFAULT 0,
  status_code INT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT capability_usage_events_usage_units_check CHECK (usage_units > 0),
  CONSTRAINT capability_usage_events_unit_price_check CHECK (unit_price_micros >= 0),
  CONSTRAINT capability_usage_events_estimated_amount_check CHECK (estimated_amount_micros >= 0)
);

CREATE INDEX IF NOT EXISTS idx_capability_usage_events_merchant_created
  ON capability_usage_events (merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_capability_usage_events_entry_created
  ON capability_usage_events (capability_vault_entry_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_capability_usage_events_event_type
  ON capability_usage_events (event_type, created_at DESC);
