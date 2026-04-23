ALTER TABLE rcm_milestones
  ADD COLUMN IF NOT EXISTS billing_ref TEXT,
  ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS principal_mandates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id       TEXT NOT NULL,
  workspace_id       UUID REFERENCES rcm_workspaces(id) ON DELETE CASCADE,
  stripe_pm_id       TEXT NOT NULL,
  stripe_customer_id TEXT,
  mandate_ref        TEXT,
  scope              TEXT NOT NULL DEFAULT 'rcm_milestones',
  max_amount_pence   INTEGER,
  approved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS principal_mandates_principal_idx
  ON principal_mandates (principal_id);

CREATE INDEX IF NOT EXISTS principal_mandates_workspace_idx
  ON principal_mandates (workspace_id);

CREATE TABLE IF NOT EXISTS principal_payment_methods (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id       TEXT NOT NULL,
  stripe_pm_id       TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT,
  last4              TEXT,
  brand              TEXT,
  is_default         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS principal_payment_methods_principal_idx
  ON principal_payment_methods (principal_id);

CREATE TABLE IF NOT EXISTS approval_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id           UUID,
  principal_id        TEXT NOT NULL,
  method              TEXT NOT NULL,
  approval_token_hash TEXT,
  device_hash         TEXT,
  amount_pence        INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'GBP',
  policy_version      TEXT,
  approved_at         TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS approval_events_principal_idx
  ON approval_events (principal_id);

CREATE INDEX IF NOT EXISTS approval_events_intent_idx
  ON approval_events (intent_id);
