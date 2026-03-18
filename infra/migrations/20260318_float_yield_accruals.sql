-- Float Yield Accrual Table
-- Tracks platform yield on escrowed / in-flight funds.
-- Phase 1: accounting only. Phase 2: wire to yield vaults.

CREATE TABLE IF NOT EXISTS float_yield_accruals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id            TEXT UNIQUE NOT NULL,
  source               TEXT NOT NULL CHECK (source IN (
                         'marketplace_escrow', 'dispute_hold',
                         'ap2_pending', 'intent_pending'
                       )),
  principal_usdc       NUMERIC(18, 6) NOT NULL,
  annual_yield_rate    NUMERIC(6,  4) NOT NULL DEFAULT 0.05,
  hold_started_at      TIMESTAMPTZ    NOT NULL,
  hold_ended_at        TIMESTAMPTZ,
  hold_hours           NUMERIC(12, 4) NOT NULL DEFAULT 0,
  accrued_yield_usdc   NUMERIC(18, 6) NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'accruing'
                         CHECK (status IN ('accruing', 'settled', 'voided')),
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_float_yield_status   ON float_yield_accruals (status);
CREATE INDEX IF NOT EXISTS idx_float_yield_source   ON float_yield_accruals (source);
CREATE INDEX IF NOT EXISTS idx_float_yield_started  ON float_yield_accruals (hold_started_at);
