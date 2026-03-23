# Dashboard Cutover Guide — Render → Cloudflare Workers

> **⚠️ STATUS: CONTROLLED CUTOVER FOUNDATION — NOT MIGRATION COMPLETE**
>
> This PR establishes the Workers backend and the single-variable cutover
> mechanism.  Several routes still return **501** and critical daemons (Solana
> listener, reconciliation, liquidity cron) remain on Render.
>
> **Do NOT flip `AGENTPAY_API_BASE_URL` to the Workers URL until you have
> completed the pre-cutover checklist below, especially the dashboard route
> audit in the last section.**  See `RENDER_RETIREMENT.md` for the full list
> of items that block a complete Render decommission.

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
  - `DATABASE_URL` — **Supabase Direct connection string (port 5432)**, NOT the
    pooled/PgBouncer URL (port 6543).  Hyperdrive does its own pooling; using
    the pooled URL as the Hyperdrive source creates double-pooling and causes
    connection errors.  If Hyperdrive is NOT yet enabled, `DATABASE_URL` is
    used directly — the Direct URL is still preferred over the pooled URL.
  - `WEBHOOK_SECRET` — same value as on Render
  - `AGENTPAY_SIGNING_SECRET` — same value as on Render
  - `VERIFICATION_SECRET` — same value as on Render
  - `ADMIN_SECRET_KEY` — same value as on Render
  - `STRIPE_SECRET_KEY` — (if Stripe is enabled)
  - `STRIPE_WEBHOOK_SECRET` — (if Stripe is enabled)
- [ ] `wrangler.toml` [vars] are set correctly in the **Cloudflare Workers dashboard** (override the defaults from wrangler.toml):
  - `NODE_ENV = "production"` — **required to enforce the AGENTPAY_TEST_MODE
    production guard**.  Without this, test-key bypass could remain open.
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

| Variable | Historical value | Current value |
|---|---|---|
| `AGENTPAY_API_BASE_URL` | historical Render backend | `https://api.agentpay.so` |

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

---

## Dashboard route-by-route audit (REQUIRED before cutover)

Before flipping `AGENTPAY_API_BASE_URL`, verify that **no beta-critical
dashboard flow depends on a 501 route**.  Walk through every dashboard page
and API call and confirm it does not hit any of the deferred routes above.

The dashboard BFF routes that use `API_BASE` are in `dashboard/app/api/` and
`dashboard/lib/api.ts`.  Check each one:

| Dashboard BFF route | Backend call | Safe to cut over? |
|---|---|---|
| `GET /api/health` | `GET {API_BASE}/health` | ✅ — Workers health |
| `GET /api/activity` | `GET {API_BASE}/api/intents/activity` | ✅ — Workers |
| `GET /api/auth/login` | `GET {API_BASE}/api/merchants/profile` | ✅ — Workers |
| `GET /api/agentrank/:id` | `GET {API_BASE}/api/agentrank/:id` | ⚠️ **501** — keep Render or remove from dashboard before cutover |
| `GET /api/escrow/stats` | `GET {API_BASE}/api/escrow/stats` | ⚠️ **501** — keep Render or hide from dashboard before cutover |
| `POST /api/demo` | `POST {API_BASE}/api/demo/run-agent-payment` | ⚠️ **501** — demo only, disable or guard before cutover |
| `POST /api/test-tip` | `POST {API_BASE}/api/test-tip` | ⚠️ **501** — test only, disable or guard before cutover |
| `GET /api/webhooks` | `GET {API_BASE}/api/webhooks` (via dashboard/app/api/webhooks/route.ts) | ✅ — Workers |

> **Action required:** For every ⚠️ row, either:
> 1. Confirm the dashboard page or feature is not reachable in the beta UI, OR
> 2. Add a graceful degradation path (e.g. return empty data on 501) in the
>    dashboard BFF route before flipping the env var, OR
> 3. Add the route to Workers before flipping.
