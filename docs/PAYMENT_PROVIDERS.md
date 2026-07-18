# Secure payment providers

AgentPay exposes one governed payment model across Stripe, Airwallex, Visa, and
x402. The implementation lives in `apps/api-edge/src/lib/paymentProviders.ts`;
the authenticated creation endpoint is `POST /api/payments/provider-intents`.
`GET /api/payments/providers` reports configuration truth without exposing
credentials.

## Safety model

- Amounts enter the provider layer only as positive safe integers in the
  currency's smallest unit. Decimal strings are generated only at Airwallex's
  API boundary.
- Sandbox is the default. Live requests require both
  `AGENTPAY_PAYMENT_MODE=live` and `AGENTPAY_LIVE_PAYMENTS_ENABLED=true`.
- `AGENTPAY_PAYMENTS_ENABLED=true` and explicit provider, currency, agent,
  network, asset, and recipient allowlists are required.
- Stripe redirect destinations must use HTTPS and match
  `AGENTPAY_ALLOWED_PAYMENT_REDIRECT_HOSTS`.
- Stripe keys must match the selected mode (`*_test_*` in sandbox and
  `*_live_*` in live mode). Airwallex sandbox calls always use its demo API.
- The database reserves `(merchant, idempotency key)` before any provider call.
  It takes a merchant-wide idempotency lock first, then a merchant/currency
  daily-limit lock, so same-key retries cannot race across currencies and
  concurrent requests cannot race past the daily cap.
- A same-key, same-request retry returns the durable original response. A
  same-key request with any changed amount, provider, agent, redirect,
  recipient, or metadata returns `409 IDEMPOTENCY_CONFLICT`.
- Stripe also receives `Idempotency-Key`; Airwallex receives a deterministic
  UUID as `request_id`.
- Provider calls have a 10-second timeout and normalized errors. Upstream
  response bodies, tokens, and secrets are not returned or logged.
- Dedicated Stripe and Airwallex provider webhooks verify signatures over the
  raw request body at `/webhooks/payment-providers/{provider}`. Airwallex also
  enforces a five-minute timestamp window.
- Webhook event deduplication and the payment state transition commit in one
  database transaction. Unknown payment references are not marked processed.
- `provider_payment_events` is append-only at the database level. Events carry
  correlation IDs and integer amounts.
- Provider action data is returned only to the authenticated merchant. Action
  URLs and client secrets are encrypted separately with a distinct base64url
  32-byte AES-GCM key in `AGENTPAY_PAYMENT_RESPONSE_ENCRYPTION_KEY`; generic
  `response_payload` contains no transient provider credential. That key is
  required for Stripe/Airwallex status to become configured.
- x402 returns unsigned payment requirements. AgentPay does not accept, store,
  or transmit seed phrases or raw private keys; a user wallet or separately
  governed signer must authorize settlement.

## Provider behavior

### Stripe

Creates hosted Checkout sessions. Card data remains on Stripe-hosted surfaces.
Fulfillment must wait for the dedicated verified provider webhook, not the
browser redirect. Configure the endpoint-specific signing secret as
`STRIPE_PROVIDER_WEBHOOK_SECRET`.

Official documentation:

- https://docs.stripe.com/api/idempotent_requests
- https://docs.stripe.com/webhooks/signature
- https://docs.stripe.com/payments/checkout

### Airwallex

Authenticates server-side, creates PaymentIntents in demo or production, and
uses `request_id` for retry safety. `client_secret` is returned only to the
authenticated caller that created the intent and is encrypted separately for
the same-key replay path. Fulfillment waits for
`payment_intent.succeeded` at the dedicated webhook; configure its signing
secret as `AIRWALLEX_PROVIDER_WEBHOOK_SECRET`.

Official documentation:

- https://www.airwallex.com/docs/payments/get-started/using-payments-intent-api
- https://www.airwallex.com/docs/developer-tools/webhooks/listen-for-webhook-events
- https://www.airwallex.com/docs/payments/reference/payments-webhooks

### Visa

There is no generic "Visa API." AgentPay reports
`visa_cybersource` as disabled until the owner has a Visa
Acceptance/Cybersource merchant account, chooses the approved product, and
receives sandbox credentials. Visa Direct is a separate push-payment product
that requires an eligible originator/acquirer sponsorship and production
approval; it must not be represented as ordinary card acceptance.

Official documentation:

- https://developer.visaacceptance.com/
- https://developer.visa.com/capabilities/visa_direct/docs

### Crypto / x402

The adapter is non-custodial and allowlist-only. It produces a requirement for
the configured network, asset, recipient, and amount; it does not fabricate a
transaction hash or provider success. Verification and final state transitions
must be tied to chain finality through the existing verification routes.

Official documentation:

- https://docs.cdp.coinbase.com/x402/welcome
- https://github.com/coinbase/x402
- https://developers.circle.com/stablecoins/usdc-contract-addresses

## Compliance boundaries

This architecture reduces card-data exposure but does not itself make AgentPay
PCI DSS compliant. Stripe/Airwallex hosted collection, webhook controls, access
reviews, incident response, vulnerability management, and the applicable PCI
SAQ remain operator responsibilities. Provider onboarding, KYC/KYB, sanctions
screening, refunds, disputes, tax, safeguarding, and money-transmission analysis
remain the responsibility of AgentPay and its regulated providers.

AgentPay is non-custodial for x402 in this implementation. Adding an automated
signer, smart-account policy, or treasury wallet changes the custody and
security model and requires a separate threat model and explicit approval.

## Commerce boundary

This provider API is the execution boundary behind an approved purchase
mandate. It is not a catalog, recommendation engine, wallet, or merchant of
record. The merchant remains responsible for inventory, tax, order acceptance,
fulfillment, returns, refunds, and customer support. A commerce client should
bind the exact merchant, amount, currency, items, refundability requirement,
and expiry before creating a provider intent.

## Staging order

1. Apply `migrations/20260416_processed_webhook_events.sql`, then
   `migrations/20260718_secure_payment_providers.sql` to staging.
2. Keep `AGENTPAY_PAYMENT_MODE=sandbox`,
   `AGENTPAY_LIVE_PAYMENTS_ENABLED=false`, and
   `AGENTPAY_PAYMENTS_ENABLED=false` while configuring credentials.
   Generate a distinct 32-byte AES-GCM response-encryption key and store it
   only in the approved secret manager/Worker secret surface.
3. Register the dedicated staging webhook endpoints and verify signed success,
   failure, cancellation, duplicate, and unknown-reference events.
4. Enable the master switch for one internal sandbox agent and one provider.
5. Reconcile the provider dashboard against `provider_payment_requests` and
   append-only `provider_payment_events` before considering live mode.
