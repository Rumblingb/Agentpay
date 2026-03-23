# Environment Reference — AgentPay

> **Version:** 1.0  
> **Last Updated:** 2026-03-11

AgentPay has two distinct runtime surfaces with separate configuration systems. Do not conflate them.

---

## Overview

| Surface | Config mechanism | Secret storage |
|---------|-----------------|----------------|
| **Cloudflare Workers API** (`apps/api-edge/`) | `apps/api-edge/wrangler.toml` (non-secrets) + `wrangler secret put` | Cloudflare encrypted secret store |
| **Local Workers dev** | `apps/api-edge/.dev.vars` | Local file — never committed |
| **Legacy Node.js backend** (`src/`) | `.env` file | Local file — never committed |
| **Vercel Dashboard** | Vercel project environment variables | Vercel |

---

## 1. Cloudflare Workers API

### Secrets (production)

Set secrets via the Wrangler CLI or the Cloudflare Workers dashboard. These are encrypted and never appear in source code or `apps/api-edge/wrangler.toml`.

```bash
wrangler secret put DATABASE_URL
wrangler secret put WEBHOOK_SECRET
wrangler secret put AGENTPAY_SIGNING_SECRET
wrangler secret put VERIFICATION_SECRET
wrangler secret put ADMIN_SECRET_KEY
wrangler secret put STRIPE_SECRET_KEY        # optional — enables Stripe routes
wrangler secret put STRIPE_WEBHOOK_SECRET    # optional — required for /webhooks/stripe
```

| Secret | Description |
|--------|-------------|
| `DATABASE_URL` | Supabase Direct connection string (port **5432**, not the pooled PgBouncer URL on port 6543). Hyperdrive requires the Direct URL to avoid double-pooling. |
| `WEBHOOK_SECRET` | ≥32 chars — HMAC-SHA256 key for signing outgoing webhook payloads. |
| `AGENTPAY_SIGNING_SECRET` | ≥32 chars — HMAC key for AP2 payment receipt signatures. |
| `VERIFICATION_SECRET` | ≥32 chars — HMAC key for verification certificate signatures. |
| `ADMIN_SECRET_KEY` | Bearer token for admin-only API endpoints (`x-admin-key` header). |
| `STRIPE_SECRET_KEY` | Stripe API key (`sk_live_*` or `sk_test_*`). Optional — leave unset to disable Stripe routes. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_*`). Required if Stripe is enabled. |

**Important:** `AGENTPAY_TEST_MODE` must be absent or `"false"` in production. The Workers API enforces this on startup — it will reject requests if test-mode bypass is active in a production environment.

### Non-secret variables (`apps/api-edge/wrangler.toml [vars]`)

These are non-sensitive and can be committed in `apps/api-edge/wrangler.toml`. Override them in the Cloudflare Workers dashboard for production.

| Variable | Example | Description |
|----------|---------|-------------|
| `NODE_ENV` | `"production"` | Runtime environment name. **Must be `"production"` in the Cloudflare dashboard** to enforce production safety guards. |
| `CORS_ORIGIN` | `"https://apay-delta.vercel.app,https://dashboard.agentpay.gg"` | Comma-separated list of allowed CORS origins. |
| `API_BASE_URL` | `"https://api.agentpay.so"` | Public base URL of this Workers deployment. Used for absolute callback URLs. |
| `FRONTEND_URL` | `"https://apay-delta.vercel.app"` | Dashboard URL for post-payment redirects. |

### Hyperdrive

Hyperdrive is a Cloudflare connection pooler and caching layer that sits between Workers and Supabase. Once configured, it replaces `DATABASE_URL` at runtime with a local connection string.

```toml
# apps/api-edge/wrangler.toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "be606bac9fde4493b21fff2e085eb82c"
```

When Hyperdrive is active, the `HYPERDRIVE.connectionString` value is used instead of `DATABASE_URL`. The Hyperdrive config in the Cloudflare dashboard must be created with the **Direct URL** (port 5432) as the source — not the pooled PgBouncer URL.

---

## 2. Local Workers Development

For local `wrangler dev`, create `apps/api-edge/.dev.vars` (never commit this file — it is git-ignored).

```bash
cd apps/api-edge
cp .dev.vars.example .dev.vars
# edit .dev.vars with your values
npx wrangler dev
```

Wrangler reads `.dev.vars` automatically. The format is:

```ini
DATABASE_URL="postgresql://..."
WEBHOOK_SECRET="your-local-secret-at-least-32-chars"
AGENTPAY_SIGNING_SECRET="your-local-secret-at-least-32-chars"
VERIFICATION_SECRET="your-local-secret-at-least-32-chars"
ADMIN_SECRET_KEY="your-local-admin-key"
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
API_BASE_URL=http://localhost:8787
FRONTEND_URL=http://localhost:3000
AGENTPAY_TEST_MODE=false
```

---

## 3. Legacy Node.js Backend

The legacy Express backend (`src/`) reads from a `.env` file in the repository root.

```bash
cp .env.production.example .env
# edit .env with your values
npm run dev
```

See `.env.production.example` for the full annotated list. The minimum required variables are:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `DIRECT_URL` | Direct PostgreSQL URL (for Prisma migrations) |
| `WEBHOOK_SECRET` | ≥32 chars — HMAC webhook signing key |
| `AGENTPAY_SIGNING_SECRET` | ≥32 chars — wallet encryption key |
| `VERIFICATION_SECRET` | ≥32 chars — JWT signing secret |
| `PORT` | HTTP port (default: `3001`) |
| `NODE_ENV` | `"development"` or `"production"` |

The legacy backend also supports:

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `SOLANA_RPC_URL` | Solana RPC endpoint |
| `ADMIN_SECRET_KEY` | Admin endpoint bearer token |
| `CORS_ORIGIN` | Comma-separated allowed origins |
| `API_BASE_URL` | Public base URL for this server |
| `RATE_LIMIT_MAX_REQUESTS` | Global rate limit per 15-min window (default: 100) |

Generate strong secrets for all three `*_SECRET` variables:

```bash
npm run generate:secrets
```

---

## 4. Dashboard (Vercel)

The Next.js dashboard is deployed on Vercel. The primary variable that controls which backend it talks to is:

| Variable | Description |
|----------|-------------|
| `AGENTPAY_API_BASE_URL` | Base URL of the production API backend. Set this to the Workers deployment URL (`https://api.agentpay.so` in production, `http://localhost:8787` locally). |

Set this in the Vercel project dashboard under **Settings → Environment Variables**.

See `dashboard/.env.example` for any additional dashboard-specific variables.

---

## 5. Supabase Connection Strings

Supabase provides two connection endpoints:

| Endpoint | Port | Use |
|----------|------|-----|
| **Direct** (Session Mode) | `5432` | Cloudflare Workers (`DATABASE_URL`), Prisma migrations (`DIRECT_URL`) |
| **Pooled** (Transaction Mode / PgBouncer) | `6543` | Not recommended with Hyperdrive — causes double-pooling |

**Rule:** Always supply the Direct URL (port 5432) to `DATABASE_URL` in the Workers environment and to the Hyperdrive source configuration. Hyperdrive handles its own pooling.

---

## 6. Secret Generation

Never use placeholder values or short secrets in any environment. Generate strong random secrets:

```bash
# Node.js (32-byte hex string)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Or use the repo helper (generates all required secrets at once)
npm run generate:secrets
```

Minimum secret lengths enforced at runtime:
- `WEBHOOK_SECRET` — ≥32 characters
- `AGENTPAY_SIGNING_SECRET` — ≥32 characters
- `VERIFICATION_SECRET` — ≥32 characters

The Workers API will reject requests (HTTP 500) and the legacy backend will refuse to start if any of these are missing, too short, or set to known placeholder values.

---

## Summary: Which Config Goes Where

| Variable | Workers `apps/api-edge/wrangler.toml` | Workers secret | `.dev.vars` | `.env` | Vercel |
|----------|------------------------|---------------|-------------|--------|--------|
| `DATABASE_URL` | ❌ | ✅ | ✅ | ✅ | ❌ |
| `WEBHOOK_SECRET` | ❌ | ✅ | ✅ | ✅ | ❌ |
| `AGENTPAY_SIGNING_SECRET` | ❌ | ✅ | ✅ | ✅ | ❌ |
| `VERIFICATION_SECRET` | ❌ | ✅ | ✅ | ✅ | ❌ |
| `ADMIN_SECRET_KEY` | ❌ | ✅ | ✅ | ✅ | ❌ |
| `STRIPE_SECRET_KEY` | ❌ | ✅ | ✅ | ✅ | ❌ |
| `CORS_ORIGIN` | ✅ (override in dashboard) | ❌ | ✅ | ✅ | ❌ |
| `NODE_ENV` | ✅ (override in dashboard) | ❌ | ✅ | ✅ | ❌ |
| `API_BASE_URL` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `AGENTPAY_API_BASE_URL` | ❌ | ❌ | ❌ | ❌ | ✅ |
