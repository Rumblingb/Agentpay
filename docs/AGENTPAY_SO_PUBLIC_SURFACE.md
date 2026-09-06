# agentpay.so public surface

**Date:** 2026-08-27  
**Worker:** `workers/agentpay-landing/` → Cloudflare `agentpay-landing-production`  
**This PR does not deploy.**

## Ownership

| Surface | Serves | In this repo |
|---------|--------|----------------|
| `https://agentpay.so/*` | Cloudflare Worker `agentpay-landing-production` | `workers/agentpay-landing/` |
| `https://api.agentpay.so` | Cloudflare Worker `agentpay-api` | `apps/api-edge/` |
| `https://docs.agentpay.so` | Vercel `apps/docs` | `apps/docs/` |
| `https://app.agentpay.so` | Vercel dashboard | `dashboard/` |
| Repo-root `index.html` | leftover, not live | do not treat as marketing |

`agentpay.gg` DNS is dead. Leave it dark. Production CORS is `https://agentpay.so,https://app.agentpay.so` plus the existing Vercel preview origin. Do not list `agentpay.gg` or `dashboard.agentpay.gg`.

Public `/`, `/start`, and `/docs` stay AgentPay-only: guardrails + payment authority. Do not name Ace, IRCTC, National Rail, or Postizzz. Do not advertise UPI or Open Banking until those rails settle with a receipt. H1 stays locked:

> Your agent can pay with a card or with crypto. One key. You set the limit.

## Rollback

`deploy-routing-fix.sh` records the current 100% version before upload. Roll back with that version id. Do not deploy from this PR without that token and confirmation gate.
