-- Migration: fee_ledger_entries
-- Purpose: Outbox table for platform fee collection — tracks every payment's
--          fee obligation from creation through treasury settlement.
--
-- Status flow:
--   pending    → created when intent is confirmed on-chain; fee not yet collected
--   processing → fee transfer to treasury attempted; awaiting Solana confirmation
--   complete   → fee_transfer_signature set; treasury received funds
--   failed     → transfer failed; cron will retry (up to MAX_ATTEMPTS)
--   terminal   → max retries exceeded; requires manual intervention + alert

CREATE TABLE IF NOT EXISTS fee_ledger_entries (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intent this fee entry belongs to (1:1)
  intent_id             UUID          NOT NULL REFERENCES payment_intents(id),

  -- Populated once the intent_resolutions row is created
  intent_resolution_id  UUID          REFERENCES intent_resolutions(id),

  -- Amounts — all in USDC
  gross_amount          DECIMAL(20,6) NOT NULL,   -- total amount payer sent
  platform_fee_amount   DECIMAL(20,6) NOT NULL,   -- AgentPay's cut (fee_bps/10000 * gross)
  rail_fee_amount       DECIMAL(20,6) NOT NULL DEFAULT 0, -- Solana network fee (SOL, tracked for reporting)
  net_recipient_amount  DECIMAL(20,6) NOT NULL,   -- gross - platform_fee

  -- Wallet addresses at time of settlement (snapshot — wallets can change)
  treasury_destination  TEXT          NOT NULL,   -- platform treasury wallet
  recipient_destination TEXT          NOT NULL,   -- merchant/recipient wallet

  -- Settlement reference — verification token or Solana memo used for this intent
  settlement_reference  TEXT,

  -- Populated when treasury fee transfer succeeds
  fee_transfer_signature TEXT,

  -- Lifecycle
  status                TEXT          NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','complete','failed','terminal')),
  failure_reason        TEXT,
  attempt_count         INT           NOT NULL DEFAULT 0,
  last_attempted_at     TIMESTAMPTZ,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  settled_at            TIMESTAMPTZ,

  -- One fee entry per intent
  CONSTRAINT fee_ledger_entries_intent_id_key UNIQUE (intent_id)
);

CREATE INDEX IF NOT EXISTS idx_fee_ledger_status
  ON fee_ledger_entries (status)
  WHERE status IN ('pending', 'processing', 'failed');

CREATE INDEX IF NOT EXISTS idx_fee_ledger_intent_id
  ON fee_ledger_entries (intent_id);

CREATE INDEX IF NOT EXISTS idx_fee_ledger_created_at
  ON fee_ledger_entries (created_at DESC);

COMMENT ON TABLE fee_ledger_entries IS
  'Outbox table for platform fee collection. Every confirmed payment generates one row. '
  'The cron reconciler processes rows until status = complete or terminal.';
