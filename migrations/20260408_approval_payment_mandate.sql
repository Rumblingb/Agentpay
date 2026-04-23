-- Migration: ace_intents + journey_sessions + approval_events
--            + principal_payment_methods + principal_mandates
-- Run once against Supabase Direct connection (port 5432)
-- Dashboard: https://supabase.com/dashboard -> your project -> SQL Editor

-- ─── 1. ace_intents ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ace_intents (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id          text        NOT NULL,
  operator_id           text        NOT NULL,
  source                text        NOT NULL CHECK (source IN ('direct_human', 'delegated_agent')),
  objective             text        NOT NULL,
  constraints_json      jsonb,
  status                text        NOT NULL DEFAULT 'draft',
  recommendation_json   jsonb,
  approval_json         jsonb,
  actor_id              text,
  approved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ace_intents_principal_id_idx ON ace_intents (principal_id);
CREATE INDEX IF NOT EXISTS ace_intents_operator_id_idx  ON ace_intents (operator_id);
CREATE INDEX IF NOT EXISTS ace_intents_status_idx       ON ace_intents (status);

-- ─── 2. journey_sessions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journey_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id     uuid        NOT NULL REFERENCES ace_intents(id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'scheduled',
  phase         text,
  live_data     jsonb,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS journey_sessions_intent_id_idx ON journey_sessions (intent_id);

-- ─── 3. approval_events ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approval_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id      uuid        REFERENCES ace_intents(id) ON DELETE SET NULL,
  principal_id   text        NOT NULL,
  method         text        NOT NULL DEFAULT 'biometric',
  device_hash    text,
  amount_pence   integer,
  currency       text        NOT NULL DEFAULT 'GBP',
  approved_at    timestamptz,
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS approval_events_principal_idx ON approval_events (principal_id);
CREATE INDEX IF NOT EXISTS approval_events_intent_idx    ON approval_events (intent_id);

-- ─── 4. principal_payment_methods ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS principal_payment_methods (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id        text    NOT NULL,
  stripe_pm_id        text    NOT NULL UNIQUE,
  stripe_customer_id  text,
  brand               text,
  last4               text,
  exp_month           integer,
  exp_year            integer,
  is_default          boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS principal_payment_methods_principal_idx
  ON principal_payment_methods (principal_id);

-- ─── 5. principal_mandates ───────────────────────────────────────────────────
-- Note: workspace_id is a plain uuid (no FK) — rcm_workspaces may not exist yet.
CREATE TABLE IF NOT EXISTS principal_mandates (
  id                   uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id         text    NOT NULL,
  workspace_id         uuid,
  stripe_pm_id         text    NOT NULL,
  stripe_customer_id   text,
  mandate_ref          text,
  scope                text    NOT NULL DEFAULT 'rcm_milestones',
  max_amount_pence     integer,
  approved_at          timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz,
  revoked_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS principal_mandates_principal_idx
  ON principal_mandates (principal_id);
CREATE INDEX IF NOT EXISTS principal_mandates_workspace_idx
  ON principal_mandates (workspace_id);

-- ─── 6. rcm_milestones backfill columns (only if table exists) ───────────────
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'rcm_milestones') THEN
    ALTER TABLE rcm_milestones ADD COLUMN IF NOT EXISTS billing_ref text;
    ALTER TABLE rcm_milestones ADD COLUMN IF NOT EXISTS billed_at   timestamptz;
  END IF;
END $$;
