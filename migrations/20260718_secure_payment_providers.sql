-- Provider-neutral payment request idempotency and append-only audit events.
-- Amounts are always integer smallest currency units.

CREATE TABLE IF NOT EXISTS provider_payment_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id       uuid NOT NULL REFERENCES merchants(id),
  agent_id           text NOT NULL,
  provider           text NOT NULL CHECK (provider IN ('stripe', 'airwallex', 'visa_cybersource', 'x402')),
  idempotency_key    text NOT NULL,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  currency           char(3) NOT NULL,
  state              text NOT NULL CHECK (state IN ('created', 'requires_action', 'processing', 'succeeded', 'failed', 'cancelled')),
  provider_reference text,
  request_hash       text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response_payload   jsonb CHECK (response_payload IS NULL OR jsonb_typeof(response_payload) = 'object'),
  sensitive_response_ciphertext text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  UNIQUE (merchant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_provider_payment_requests_daily_policy
  ON provider_payment_requests (merchant_id, currency, created_at DESC)
  WHERE state NOT IN ('failed', 'cancelled');

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_payment_requests_provider_reference
  ON provider_payment_requests (provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS provider_payment_events (
  sequence_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_request_id uuid REFERENCES provider_payment_requests(id),
  merchant_id        uuid NOT NULL REFERENCES merchants(id),
  provider           text NOT NULL,
  event_type         text NOT NULL,
  correlation_id     text NOT NULL,
  provider_event_id  text,
  state              text,
  amount_minor       bigint,
  currency           char(3),
  details            jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_payment_events_correlation
  ON provider_payment_events (merchant_id, correlation_id, sequence_id);

CREATE OR REPLACE FUNCTION reject_provider_payment_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'provider_payment_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS provider_payment_events_no_update ON provider_payment_events;
CREATE TRIGGER provider_payment_events_no_update
BEFORE UPDATE ON provider_payment_events
FOR EACH ROW EXECUTE FUNCTION reject_provider_payment_event_mutation();

DROP TRIGGER IF EXISTS provider_payment_events_no_delete ON provider_payment_events;
CREATE TRIGGER provider_payment_events_no_delete
BEFORE DELETE ON provider_payment_events
FOR EACH ROW EXECUTE FUNCTION reject_provider_payment_event_mutation();
