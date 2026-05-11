-- MCP Registry: stdio transport support + publisher payouts
-- Run after 20260511000000_mcp_registry.sql

ALTER TABLE mcp_servers
  ADD COLUMN IF NOT EXISTS transport      text NOT NULL DEFAULT 'http',
  ADD COLUMN IF NOT EXISTS github_url     text,
  ADD COLUMN IF NOT EXISTS command        text,
  ADD COLUMN IF NOT EXISTS command_args   jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS command_env    jsonb DEFAULT '{}';

-- domain_verified not required for stdio servers (no HTTP server to probe)
-- status auto-set to active for stdio + verified publishers

CREATE TABLE IF NOT EXISTS publisher_payouts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id      text        NOT NULL,
  period_start      date        NOT NULL,
  period_end        date        NOT NULL,
  gross_earned_usd  numeric(12,4) NOT NULL DEFAULT 0,
  platform_fee_usd  numeric(12,4) NOT NULL DEFAULT 0,
  net_payout_usd    numeric(12,4) NOT NULL DEFAULT 0,
  status            text        NOT NULL DEFAULT 'pending',
  paid_at           timestamptz,
  payment_ref       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(publisher_id, period_start)
);

CREATE INDEX IF NOT EXISTS publisher_payouts_publisher_idx ON publisher_payouts (publisher_id, status);
