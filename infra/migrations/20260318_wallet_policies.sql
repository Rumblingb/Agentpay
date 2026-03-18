-- Migration: hosted agent wallets + spending policies
-- Date: 2026-03-18

-- ── Agent Wallets ─────────────────────────────────────────────────────────────
-- Custodial USDC balance per agentId. Platform holds funds in pooled treasury.

CREATE TABLE IF NOT EXISTS agent_wallets (
  agent_id       TEXT         PRIMARY KEY REFERENCES agent_identities(agent_id) ON DELETE CASCADE,
  balance_usdc   NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (balance_usdc >= 0),
  reserved_usdc  NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (reserved_usdc >= 0),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  metadata       JSONB        NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_agent_wallets_balance
  ON agent_wallets (balance_usdc DESC)
  WHERE balance_usdc > 0;

-- ── Spending Policies ─────────────────────────────────────────────────────────
-- Per-agent spending controls. Enforced at payment-intent creation time.

CREATE TABLE IF NOT EXISTS agent_spending_policies (
  agent_id    TEXT         PRIMARY KEY REFERENCES agent_identities(agent_id) ON DELETE CASCADE,
  policy      JSONB        NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── payment_intents: ensure agent_id column exists ────────────────────────────
-- Some deployments may not have this column yet (added in Phase 6).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_intents' AND column_name = 'agent_id'
  ) THEN
    ALTER TABLE payment_intents ADD COLUMN agent_id TEXT REFERENCES agent_identities(agent_id);
    CREATE INDEX IF NOT EXISTS idx_payment_intents_agent_id ON payment_intents (agent_id);
  END IF;
END $$;
