# Dashboard Cutover Guide — Render → Cloudflare Workers

This document describes the **single environment variable change** needed to cut
the dashboard's backend traffic over from Render to Cloudflare Workers.

---

## What changes

The dashboard reads `AGENTPAY_API_BASE_URL` (a server-side-only Next.js env var)
for every outbound call to the backend API.  Changing this one variable is all
that's needed to switch backends.

---

## Pre-cutover checklist

Before flipping the switch, verify:

- [ ] Workers deployment is live and responding to `GET /health`
  ```
  curl https://agentpay-api.workers.dev/health
  # Expected: {"status":"active","timestamp":"...","services":{...},"version":"1.0.0"}
  ```
- [ ] Required secrets are set in the Cloudflare Workers dashboard:
  - `DATABASE_URL` — Supabase pooled connection string
  - `WEBHOOK_SECRET` — same value as on Render
  - `AGENTPAY_SIGNING_SECRET` — same value as on Render
  - `VERIFICATION_SECRET` — same value as on Render
  - `ADMIN_SECRET_KEY` — same value as on Render
  - `STRIPE_SECRET_KEY` — (if Stripe is enabled)
  - `STRIPE_WEBHOOK_SECRET` — (if Stripe is enabled)
- [ ] `wrangler.toml` [vars] are set correctly:
  - `CORS_ORIGIN` — includes your Vercel production domain
    e.g. `"https://apay-delta.vercel.app,https://dashboard.agentpay.gg"`
  - `API_BASE_URL` — your Workers URL
    e.g. `"https://agentpay-api.workers.dev"`
  - `FRONTEND_URL` — your Vercel dashboard URL
    e.g. `"https://apay-delta.vercel.app"`
- [ ] Stripe webhook endpoint in the Stripe dashboard is updated to the Workers URL:
  `https://agentpay-api.workers.dev/webhooks/stripe`

---

## Cutover: single env var change in Vercel

In the Vercel dashboard → Your Project → Settings → Environment Variables:

| Variable | Old value | New value |
|---|---|---|
| `AGENTPAY_API_BASE_URL` | `https://agentpay.onrender.com` | `https://agentpay-api.workers.dev` |

Then redeploy the Vercel dashboard (or trigger a redeployment).

---

## Rollback

To roll back to Render, revert `AGENTPAY_API_BASE_URL` to the Render URL and
redeploy Vercel.  The Render backend remains fully intact during this migration.

---

## Routes available on Workers (Phases 4–10)

| Route | Phase | Status |
|---|---|---|
| GET /health | 4 | ✅ |
| GET /api/health | 4 | ✅ |
| GET /api | 4 | ✅ |
| POST /api/merchants/register | 7 | ✅ |
| GET /api/merchants/profile | 7 | ✅ |
| GET /api/merchants/me | 7 | ✅ |
| GET /api/merchants/webhooks | 7 | ✅ |
| PATCH /api/merchants/profile/webhook | 7 | ✅ |
| GET /api/merchants/stats | 7 | ✅ |
| GET /api/merchants/payments | 7 | ✅ |
| GET /api/merchants/payments/:id | 7 | ✅ |
| POST /api/merchants/payments | 7 | ✅ |
| POST /api/merchants/rotate-key | 7 | ✅ |
| GET /api/intents | 8 | ✅ |
| POST /api/intents | 8 | ✅ |
| GET /api/intents/:id/status | 8 | ✅ |
| PATCH /api/intents/:id/agent | 8 | ✅ |
| GET /api/intents/activity | 8 | ✅ |
| POST /api/v1/payment-intents | 8 | ✅ (PIN-less only) |
| GET /api/v1/payment-intents/:id | 8 | ✅ |
| POST /api/v1/payment-intents/:id/verify | 8 | ✅ |
| GET /api/verify/:txHash | 9 | ✅ |
| POST /api/certificates/validate | 9 | ✅ |
| GET /api/receipt/:intentId | 9 | ✅ |
| POST /api/webhooks/subscribe | 10 | ✅ |
| GET /api/webhooks | 10 | ✅ |
| DELETE /api/webhooks/:id | 10 | ✅ |
| POST /api/webhooks/inbound | 10 | ✅ |
| POST /webhooks/stripe | 10 | ✅ |

## Routes returning 501 (not yet migrated — use Render)

| Route | Reason deferred |
|---|---|
| GET /api/escrow/stats | In-memory escrow — not Workers-compatible |
| GET /api/agentrank/:agentId | AgentRank service not yet migrated |
| POST /api/merchants/payments/:id/verify | Solana RPC + certificate + billing |
| POST /api/intents/fiat | Stripe Connect session creation |
| POST /api/demo/run-agent-payment | Demo only |
| POST /api/test-tip | Test only |
| GET /metrics | Prometheus — use Cloudflare Analytics instead |
