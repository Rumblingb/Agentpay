-- Product signal ledger for host-native MCP, capability, funding, and billing attribution.
-- Purpose:
--   1. Keep one append-only signal stream across AgentPay host runtime surfaces.
--   2. Preserve host and auth attribution through checkout and settlement.
--   3. Support admin reporting and ranked change-candidate generation.

CREATE TABLE IF NOT EXISTS product_signal_events (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id                uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  audience                   text NOT NULL DEFAULT 'generic',
  auth_type                  text NOT NULL DEFAULT 'none',
  surface                    text NOT NULL,
  signal_type                text NOT NULL,
  status                     text,
  request_id                 text,
  entity_type                text,
  entity_id                  text,
  estimated_revenue_micros   bigint NOT NULL DEFAULT 0,
  realized_revenue_micros    bigint NOT NULL DEFAULT 0,
  estimated_cost_micros      bigint NOT NULL DEFAULT 0,
  metadata                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_signal_events_audience_check
    CHECK (audience IN ('openai', 'anthropic', 'generic')),
  CONSTRAINT product_signal_events_auth_type_check
    CHECK (auth_type IN ('api_key', 'mcp_token', 'none')),
  CONSTRAINT product_signal_events_surface_check
    CHECK (surface IN ('mcp', 'capabilities', 'payments', 'billing', 'webhooks', 'admin')),
  CONSTRAINT product_signal_events_estimated_revenue_check
    CHECK (estimated_revenue_micros >= 0),
  CONSTRAINT product_signal_events_realized_revenue_check
    CHECK (realized_revenue_micros >= 0),
  CONSTRAINT product_signal_events_estimated_cost_check
    CHECK (estimated_cost_micros >= 0)
);

CREATE INDEX IF NOT EXISTS idx_product_signal_events_merchant_created
  ON product_signal_events (merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_signal_events_signal_type_created
  ON product_signal_events (signal_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_signal_events_audience_created
  ON product_signal_events (audience, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_signal_events_request_id
  ON product_signal_events (request_id)
  WHERE request_id IS NOT NULL;
