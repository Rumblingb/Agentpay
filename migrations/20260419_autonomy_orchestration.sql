CREATE TABLE IF NOT EXISTS authority_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL,
  operator_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  wallet_status TEXT NOT NULL DEFAULT 'missing',
  preferred_funding_rail TEXT,
  default_payment_method_type TEXT,
  default_payment_reference TEXT,
  contact_email TEXT,
  contact_name TEXT,
  autonomy_policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  limits_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT authority_profiles_status_check CHECK (status IN ('active', 'revoked', 'paused')),
  CONSTRAINT authority_profiles_wallet_status_check CHECK (wallet_status IN ('missing', 'pending', 'ready'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_authority_profiles_merchant_principal
  ON authority_profiles (merchant_id, principal_id);

CREATE INDEX IF NOT EXISTS idx_authority_profiles_operator
  ON authority_profiles (operator_id);

CREATE TABLE IF NOT EXISTS capability_execution_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  capability_vault_entry_id UUID NOT NULL REFERENCES capability_vault_entries(id) ON DELETE CASCADE,
  authority_profile_id UUID REFERENCES authority_profiles(id) ON DELETE SET NULL,
  hosted_action_session_id UUID REFERENCES hosted_action_sessions(id) ON DELETE SET NULL,
  principal_id TEXT,
  operator_id TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending_human_step',
  blocked_reason TEXT,
  method TEXT NOT NULL DEFAULT 'GET',
  path TEXT NOT NULL DEFAULT '/',
  query_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  headers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  body_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT,
  host_context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  guardrail_context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  authority_context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_action_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  locked_unit_price_micros INT NOT NULL DEFAULT 0,
  locked_currency TEXT NOT NULL DEFAULT 'USD',
  used_calls_snapshot INT NOT NULL DEFAULT 0,
  free_calls_snapshot INT NOT NULL DEFAULT 0,
  resume_count INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT capability_execution_attempts_status_check CHECK (
    status IN ('pending_human_step', 'resuming', 'completed', 'failed', 'expired')
  ),
  CONSTRAINT capability_execution_attempts_locked_unit_price_check CHECK (locked_unit_price_micros >= 0),
  CONSTRAINT capability_execution_attempts_used_calls_check CHECK (used_calls_snapshot >= 0),
  CONSTRAINT capability_execution_attempts_free_calls_check CHECK (free_calls_snapshot >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_capability_execution_attempts_idempotency
  ON capability_execution_attempts (merchant_id, capability_vault_entry_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_capability_execution_attempts_capability_created
  ON capability_execution_attempts (capability_vault_entry_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_capability_execution_attempts_hosted_action
  ON capability_execution_attempts (hosted_action_session_id);

CREATE INDEX IF NOT EXISTS idx_capability_execution_attempts_status_expires
  ON capability_execution_attempts (status, expires_at DESC);
