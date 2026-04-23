-- Hosted MCP pricing and usage ledger
-- Purpose:
--   1. Give merchants a first-class hosted MCP plan field.
--   2. Record append-only MCP usage events for metering and future invoicing.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS hosted_mcp_plan_code text NOT NULL DEFAULT 'launch';

DO $$
BEGIN
  ALTER TABLE merchants
    ADD CONSTRAINT merchants_hosted_mcp_plan_code_check
    CHECK (hosted_mcp_plan_code IN ('launch', 'builder', 'growth', 'enterprise'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS hosted_mcp_pricing_override_json jsonb;

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS stripe_billing_customer_id text;

CREATE TABLE IF NOT EXISTS merchant_invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id        uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  intent_id          uuid REFERENCES payment_intents(id),
  transaction_id     uuid REFERENCES transactions(id),
  fee_amount         numeric(20, 6) NOT NULL DEFAULT 0,
  fee_percent        numeric(5, 4) NOT NULL DEFAULT 0.02,
  currency           text NOT NULL DEFAULT 'USDC',
  status             text NOT NULL DEFAULT 'pending',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchant_invoices_merchant
  ON merchant_invoices (merchant_id);

CREATE INDEX IF NOT EXISTS idx_merchant_invoices_intent
  ON merchant_invoices (intent_id);

ALTER TABLE merchant_invoices
  ADD COLUMN IF NOT EXISTS invoice_type text NOT NULL DEFAULT 'platform_fee';

ALTER TABLE merchant_invoices
  ADD COLUMN IF NOT EXISTS reference_key text;

ALTER TABLE merchant_invoices
  ADD COLUMN IF NOT EXISTS period_start timestamptz;

ALTER TABLE merchant_invoices
  ADD COLUMN IF NOT EXISTS period_end timestamptz;

ALTER TABLE merchant_invoices
  ADD COLUMN IF NOT EXISTS line_items_json jsonb;

ALTER TABLE merchant_invoices
  ADD COLUMN IF NOT EXISTS external_checkout_url text;

ALTER TABLE merchant_invoices
  ADD COLUMN IF NOT EXISTS external_checkout_session_id text;

ALTER TABLE merchant_invoices
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_invoices_reference_key
  ON merchant_invoices (reference_key)
  WHERE reference_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS mcp_usage_events (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id                  uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  plan_code                    text NOT NULL,
  auth_type                    text NOT NULL,
  audience                     text NOT NULL DEFAULT 'generic',
  event_type                   text NOT NULL,
  request_id                   text,
  tool_name                    text,
  usage_units                  integer NOT NULL DEFAULT 1,
  unit_price_usd_micros        integer NOT NULL DEFAULT 0,
  estimated_amount_usd_micros  integer NOT NULL DEFAULT 0,
  status_code                  integer,
  metadata                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_usage_events_plan_code_check
    CHECK (plan_code IN ('launch', 'builder', 'growth', 'enterprise')),
  CONSTRAINT mcp_usage_events_auth_type_check
    CHECK (auth_type IN ('api_key', 'mcp_token')),
  CONSTRAINT mcp_usage_events_audience_check
    CHECK (audience IN ('openai', 'anthropic', 'generic')),
  CONSTRAINT mcp_usage_events_event_type_check
    CHECK (event_type IN ('token_mint', 'tools_list', 'tool_call', 'transport_request')),
  CONSTRAINT mcp_usage_events_usage_units_check
    CHECK (usage_units > 0)
);

CREATE INDEX IF NOT EXISTS idx_mcp_usage_events_merchant_created
  ON mcp_usage_events (merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_usage_events_event_type
  ON mcp_usage_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_usage_events_tool_name
  ON mcp_usage_events (tool_name)
  WHERE tool_name IS NOT NULL;
