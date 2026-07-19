-- Durable AgentPay Commerce ledger.
--
-- Design rules:
--   * Money is stored as integer minor units.
--   * Decisions, approvals, and attribution events are append-only evidence.
--   * Every externally retried command has a scoped idempotency constraint.
--   * Merchant-owned checkout remains the initial settlement architecture.

CREATE TABLE IF NOT EXISTS commerce_organizations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_principal_type text NOT NULL
                        CHECK (created_by_principal_type IN ('user', 'agent', 'service')),
  created_by_principal_id text NOT NULL
                        CHECK (char_length(created_by_principal_id) BETWEEN 1 AND 255),
  name                text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  slug                text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'suspended', 'closed')),
  default_currency    char(3) NOT NULL CHECK (default_currency ~ '^[A-Z]{3}$'),
  settings            jsonb NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(settings) = 'object'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commerce_organizations_creator
  ON commerce_organizations (created_by_principal_type, created_by_principal_id, status);

CREATE TABLE IF NOT EXISTS commerce_organization_members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES commerce_organizations(id) ON DELETE CASCADE,
  principal_type      text NOT NULL CHECK (principal_type IN ('user', 'agent', 'service')),
  principal_id        text NOT NULL CHECK (char_length(principal_id) BETWEEN 1 AND 255),
  role                text NOT NULL CHECK (role IN ('owner', 'admin', 'requester', 'approver', 'auditor')),
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  attributes          jsonb NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(attributes) = 'object'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_members_principal
  ON commerce_organization_members (principal_type, principal_id, status);

CREATE TABLE IF NOT EXISTS commerce_cost_centers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES commerce_organizations(id) ON DELETE CASCADE,
  code                text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 64),
  name                text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  currency            char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  period              text NOT NULL DEFAULT 'monthly'
                        CHECK (period IN ('monthly', 'quarterly', 'annual')),
  budget_minor        bigint NOT NULL CHECK (budget_minor >= 0),
  committed_minor     bigint NOT NULL DEFAULT 0 CHECK (committed_minor >= 0),
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (committed_minor <= budget_minor),
  UNIQUE (organization_id, code)
);

-- Sellers are independent from buyer organizations and need not be onboarded
-- AgentPay merchants. UCP catalog responses are never cached; only the seller
-- identity needed for a selected checkout handoff is persisted.
CREATE TABLE IF NOT EXISTS commerce_sellers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id         uuid REFERENCES merchants(id) ON DELETE SET NULL,
  platform            text NOT NULL CHECK (platform IN ('shopify_ucp', 'ucp', 'direct')),
  external_seller_id  text NOT NULL CHECK (char_length(external_seller_id) BETWEEN 1 AND 255),
  domain              text NOT NULL CHECK (domain ~ '^[a-z0-9.-]+$'),
  display_name        text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 255),
  status              text NOT NULL DEFAULT 'observed'
                        CHECK (status IN ('observed', 'verified', 'contracted', 'suspended')),
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(metadata) = 'object'),
  first_observed_at   timestamptz NOT NULL DEFAULT now(),
  last_observed_at    timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_seller_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_sellers_contracting
  ON commerce_sellers (status, platform, last_observed_at DESC);

CREATE TABLE IF NOT EXISTS commerce_procurement_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES commerce_organizations(id),
  cost_center_id      uuid REFERENCES commerce_cost_centers(id),
  requester_type      text NOT NULL CHECK (requester_type IN ('user', 'agent', 'service')),
  requester_id        text NOT NULL CHECK (char_length(requester_id) BETWEEN 1 AND 255),
  agent_id            text,
  idempotency_key     text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  intent              text NOT NULL CHECK (char_length(intent) BETWEEN 1 AND 2000),
  state               text NOT NULL DEFAULT 'draft'
                        CHECK (state IN ('draft', 'evaluating', 'approval_required', 'approved', 'rejected', 'handed_off', 'ordered', 'cancelled', 'expired')),
  constitution_snapshot jsonb NOT NULL CHECK (jsonb_typeof(constitution_snapshot) = 'object'),
  policy_hash         text NOT NULL CHECK (policy_hash ~ '^[0-9a-f]{64}$'),
  currency            char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  max_total_minor     bigint NOT NULL CHECK (max_total_minor > 0),
  expires_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_commerce_requests_work_queue
  ON commerce_procurement_requests (organization_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS commerce_decisions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_request_id uuid NOT NULL REFERENCES commerce_procurement_requests(id),
  decision_id         text NOT NULL UNIQUE CHECK (char_length(decision_id) BETWEEN 1 AND 128),
  schema_version      text NOT NULL,
  decision_payload    jsonb NOT NULL CHECK (jsonb_typeof(decision_payload) = 'object'),
  payload_hash        text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  signature           text NOT NULL,
  signing_key_id      text NOT NULL,
  recommended_product_reference text,
  recommended_variant_reference text,
  amount_minor        bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency            char(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (procurement_request_id, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_commerce_decisions_request
  ON commerce_decisions (procurement_request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS commerce_approvals (
  sequence_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  procurement_request_id uuid NOT NULL REFERENCES commerce_procurement_requests(id),
  decision_id         uuid NOT NULL REFERENCES commerce_decisions(id),
  organization_id     uuid NOT NULL REFERENCES commerce_organizations(id),
  approver_type       text NOT NULL CHECK (approver_type IN ('user', 'agent', 'service', 'policy')),
  approver_id         text NOT NULL CHECK (char_length(approver_id) BETWEEN 1 AND 255),
  action              text NOT NULL CHECK (action IN ('approved', 'rejected', 'revoked')),
  idempotency_key     text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  policy_snapshot     jsonb NOT NULL CHECK (jsonb_typeof(policy_snapshot) = 'object'),
  policy_hash         text NOT NULL CHECK (policy_hash ~ '^[0-9a-f]{64}$'),
  reason              text,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_commerce_approvals_request
  ON commerce_approvals (procurement_request_id, sequence_id);

CREATE TABLE IF NOT EXISTS commerce_checkout_handoffs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_request_id uuid NOT NULL REFERENCES commerce_procurement_requests(id),
  decision_id         uuid NOT NULL REFERENCES commerce_decisions(id),
  organization_id     uuid NOT NULL REFERENCES commerce_organizations(id),
  seller_id           uuid NOT NULL REFERENCES commerce_sellers(id),
  product_reference   text NOT NULL CHECK (char_length(product_reference) BETWEEN 1 AND 255),
  variant_reference   text NOT NULL CHECK (char_length(variant_reference) BETWEEN 1 AND 255),
  idempotency_key     text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  nonce_hash          text NOT NULL UNIQUE CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  token_hash          text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  state               text NOT NULL DEFAULT 'created'
                        CHECK (state IN ('created', 'opened', 'converted', 'cancelled', 'expired')),
  quantity            integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  max_total_minor     bigint NOT NULL CHECK (max_total_minor > 0),
  currency            char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  checkout_url        text NOT NULL CHECK (checkout_url ~ '^https://'),
  expires_at          timestamptz NOT NULL,
  opened_at           timestamptz,
  converted_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_commerce_handoffs_seller
  ON commerce_checkout_handoffs (seller_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS commerce_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_handoff_id uuid NOT NULL REFERENCES commerce_checkout_handoffs(id),
  seller_id           uuid NOT NULL REFERENCES commerce_sellers(id),
  source              text NOT NULL CHECK (source IN ('shopify', 'woocommerce', 'direct', 'stripe', 'airwallex')),
  external_order_id   text NOT NULL CHECK (char_length(external_order_id) BETWEEN 1 AND 255),
  state               text NOT NULL CHECK (state IN ('created', 'paid', 'fulfilled', 'cancelled', 'partially_refunded', 'refunded', 'disputed')),
  subtotal_minor      bigint NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor           bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  shipping_minor      bigint NOT NULL DEFAULT 0 CHECK (shipping_minor >= 0),
  total_minor         bigint NOT NULL CHECK (total_minor >= 0),
  refunded_minor      bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  currency            char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  ordered_at          timestamptz NOT NULL,
  paid_at             timestamptz,
  fulfilled_at        timestamptz,
  cancelled_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (total_minor = subtotal_minor + tax_minor + shipping_minor),
  CHECK (refunded_minor <= total_minor),
  UNIQUE (source, seller_id, external_order_id),
  UNIQUE (checkout_handoff_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_orders_reconciliation
  ON commerce_orders (seller_id, state, ordered_at DESC);

CREATE TABLE IF NOT EXISTS commerce_refunds (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES commerce_orders(id),
  source              text NOT NULL,
  external_refund_id  text NOT NULL CHECK (char_length(external_refund_id) BETWEEN 1 AND 255),
  state               text NOT NULL CHECK (state IN ('pending', 'succeeded', 'failed', 'cancelled')),
  amount_minor        bigint NOT NULL CHECK (amount_minor > 0),
  currency            char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason              text,
  occurred_at         timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_refund_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_refunds_order
  ON commerce_refunds (order_id, state, occurred_at DESC);

CREATE TABLE IF NOT EXISTS commerce_attribution_events (
  sequence_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id     uuid REFERENCES commerce_organizations(id),
  seller_id           uuid NOT NULL REFERENCES commerce_sellers(id),
  procurement_request_id uuid REFERENCES commerce_procurement_requests(id),
  checkout_handoff_id uuid REFERENCES commerce_checkout_handoffs(id),
  order_id            uuid REFERENCES commerce_orders(id),
  source              text NOT NULL,
  event_type          text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 120),
  external_event_id   text,
  details             jsonb NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(details) = 'object'),
  occurred_at         timestamptz NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_attribution_external_event
  ON commerce_attribution_events (source, external_event_id)
  WHERE external_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commerce_attribution_reconciliation
  ON commerce_attribution_events (seller_id, event_type, occurred_at DESC);

CREATE TABLE IF NOT EXISTS commerce_fee_contracts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id           uuid NOT NULL REFERENCES commerce_sellers(id),
  version             integer NOT NULL CHECK (version > 0),
  fee_basis           text NOT NULL DEFAULT 'net_attributed_merchandise'
                        CHECK (fee_basis = 'net_attributed_merchandise'),
  fee_bps             integer NOT NULL CHECK (fee_bps BETWEEN 0 AND 10000),
  currency            char(3),
  effective_from      timestamptz NOT NULL,
  effective_until     timestamptz,
  contract_reference  text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  UNIQUE (seller_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_fee_contracts_active
  ON commerce_fee_contracts (seller_id)
  WHERE effective_until IS NULL;

CREATE TABLE IF NOT EXISTS commerce_fee_accruals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES commerce_orders(id),
  fee_contract_id     uuid NOT NULL REFERENCES commerce_fee_contracts(id),
  gross_minor         bigint NOT NULL CHECK (gross_minor >= 0),
  refund_minor        bigint NOT NULL DEFAULT 0 CHECK (refund_minor >= 0),
  net_minor           bigint NOT NULL CHECK (net_minor >= 0),
  fee_minor           bigint NOT NULL CHECK (fee_minor >= 0),
  currency            char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  state               text NOT NULL DEFAULT 'pending_return_window'
                        CHECK (state IN ('pending_return_window', 'accrued', 'invoiced', 'paid', 'waived', 'reversed')),
  return_window_ends_at timestamptz NOT NULL,
  accrued_at          timestamptz,
  invoiced_at         timestamptz,
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (refund_minor <= gross_minor),
  CHECK (net_minor = gross_minor - refund_minor),
  UNIQUE (order_id, fee_contract_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_fee_accruals_queue
  ON commerce_fee_accruals (state, return_window_ends_at);

CREATE OR REPLACE FUNCTION reject_commerce_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS commerce_decisions_no_update ON commerce_decisions;
CREATE TRIGGER commerce_decisions_no_update
BEFORE UPDATE ON commerce_decisions
FOR EACH ROW EXECUTE FUNCTION reject_commerce_evidence_mutation();

DROP TRIGGER IF EXISTS commerce_decisions_no_delete ON commerce_decisions;
CREATE TRIGGER commerce_decisions_no_delete
BEFORE DELETE ON commerce_decisions
FOR EACH ROW EXECUTE FUNCTION reject_commerce_evidence_mutation();

DROP TRIGGER IF EXISTS commerce_approvals_no_update ON commerce_approvals;
CREATE TRIGGER commerce_approvals_no_update
BEFORE UPDATE ON commerce_approvals
FOR EACH ROW EXECUTE FUNCTION reject_commerce_evidence_mutation();

DROP TRIGGER IF EXISTS commerce_approvals_no_delete ON commerce_approvals;
CREATE TRIGGER commerce_approvals_no_delete
BEFORE DELETE ON commerce_approvals
FOR EACH ROW EXECUTE FUNCTION reject_commerce_evidence_mutation();

DROP TRIGGER IF EXISTS commerce_attribution_events_no_update ON commerce_attribution_events;
CREATE TRIGGER commerce_attribution_events_no_update
BEFORE UPDATE ON commerce_attribution_events
FOR EACH ROW EXECUTE FUNCTION reject_commerce_evidence_mutation();

DROP TRIGGER IF EXISTS commerce_attribution_events_no_delete ON commerce_attribution_events;
CREATE TRIGGER commerce_attribution_events_no_delete
BEFORE DELETE ON commerce_attribution_events
FOR EACH ROW EXECUTE FUNCTION reject_commerce_evidence_mutation();
