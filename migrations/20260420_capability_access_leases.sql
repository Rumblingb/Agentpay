CREATE TABLE IF NOT EXISTS capability_access_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  capability_vault_entry_id UUID NOT NULL REFERENCES capability_vault_entries(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  principal_id TEXT,
  operator_id TEXT,
  workbench_id TEXT NOT NULL,
  workbench_label TEXT,
  lease_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT capability_access_leases_status_check CHECK (
    status IN ('active', 'revoked', 'expired')
  )
);

CREATE INDEX IF NOT EXISTS idx_capability_access_leases_merchant_workbench
  ON capability_access_leases (merchant_id, workbench_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_capability_access_leases_capability
  ON capability_access_leases (capability_vault_entry_id, status, expires_at DESC);
