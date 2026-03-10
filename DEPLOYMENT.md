# Deployment — AgentPay

This document covers deploying the AgentPay API server and dashboard.

---

## Render (API server — recommended)

Render runs migrations automatically on every deploy and provides a managed
PostgreSQL database.

1. Fork or push the repository to GitHub.
2. Create a new **Web Service** in Render and point it at the repository.
3. Render will detect `render.yaml` and pre-populate build/start commands:
   ```
   Build:  npm install --production=false && npx prisma generate && npm run build
   Start:  node scripts/migrate.js && node dist/server.js
   ```
4. Add the required environment variables (see [Environment Variables](#environment-variables) below).
5. Deploy. The health check at `/health` is used by Render to confirm the
   service is up.

---

## Vercel (dashboard only)

The Next.js dashboard lives in `dashboard/` and is deployed independently.

1. Import the repository into Vercel and set the **Root Directory** to
   `dashboard`.
2. Vercel detects `dashboard/vercel.json` for routing configuration.
3. Set `AGENTPAY_API_BASE_URL` (and any other required vars from
   `dashboard/.env.example`) in the Vercel project settings.
4. Deploy.

The dashboard does **not** run the API server — it proxies requests to the
Render deployment via the `AGENTPAY_API_BASE_URL` rewrite.

---

## Docker (local dev and self-hosted)

```bash
docker-compose up
```

This starts PostgreSQL and the API server together. The API is available on
`http://localhost:3001`.

To stop:

```bash
docker-compose down
```

---

## Manual / custom host

```bash
# Install dependencies
npm ci

# Generate Prisma client
npx prisma generate

# Build TypeScript
npm run build

# Bootstrap schema (first time only)
node scripts/create-db.js

# Apply migrations
node scripts/migrate.js

# Start
node dist/server.js
```

---

## Environment Variables

Generate strong secrets before deploying:

```bash
npm run generate:secrets
```

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `DIRECT_URL` | Direct PostgreSQL URL (Prisma migrations) |
| `WEBHOOK_SECRET` | ≥32 chars — HMAC webhook signing key |
| `AGENTPAY_SIGNING_SECRET` | ≥32 chars — AES-256-GCM wallet encryption key |
| `VERIFICATION_SECRET` | ≥32 chars — JWT signing secret |
| `STRIPE_SECRET_KEY` | Stripe API key (`sk_live_*` or `sk_test_*`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_*`) |
| `SOLANA_RPC_URL` | Solana RPC endpoint |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port |
| `CORS_ORIGIN` | — | Allowed CORS origin(s), comma-separated |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Global rate limit per 15 min window |
| `ADMIN_SECRET_KEY` | — | Secret for admin-only endpoints |
| `SENTRY_DSN` | — | Sentry error tracking DSN |
| `LIQUIDITY_BOT_ENABLED` | `true` | Enable liquidity cron job |
| `RECONCILIATION_DISABLED` | — | Set to `true` to disable reconciliation daemon |

The server **refuses to start in production** if `WEBHOOK_SECRET`,
`AGENTPAY_SIGNING_SECRET`, or `VERIFICATION_SECRET` are missing, shorter than
32 characters, or left as placeholder values.

See `.env.production.example` for the full annotated list.

---

## Health Check

```bash
curl https://<your-host>/health
# {"status":"ok","version":"0.1.0"}
```

The `/health` endpoint returns `200` when the server process is running.

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for SLOs, metrics, runbooks, and
on-call guidance.
