# Deployment — AgentPay

AgentPay has two runtime surfaces deployed independently: the Cloudflare Workers API and the Vercel dashboard. A legacy Node.js/Render backend also exists as a transitional fallback.

---

## Cloudflare Workers API (primary)

The primary production API. Handles all inbound HTTP traffic from the dashboard and external integrations.

### Prerequisites

- Cloudflare account
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Supabase project (for `DATABASE_URL`)
- Hyperdrive configured in the Cloudflare dashboard (recommended — see below)

### 1 — Install and configure

```bash
cd apps/api-edge
npm install
```

### 2 — Set secrets

```bash
wrangler secret put DATABASE_URL           # Supabase Direct URL (port 5432)
wrangler secret put WEBHOOK_SECRET         # ≥32 random chars
wrangler secret put AGENTPAY_SIGNING_SECRET
wrangler secret put VERIFICATION_SECRET
wrangler secret put ADMIN_SECRET_KEY
wrangler secret put STRIPE_SECRET_KEY      # optional
wrangler secret put STRIPE_WEBHOOK_SECRET  # optional
wrangler secret put RESEND_API_KEY         # optional — enables train booking confirmation emails
```

> **Note:** `RESEND_API_KEY` is required for the end-to-end mock booking demo (Bro app → rail agent → email). Without it the booking reference is still generated and returned; the confirmation email step is silently skipped. Sign up at [resend.com](https://resend.com) and verify `bookings@agentpay.so` as a sender domain before setting this secret.

### 3 — Configure non-secret vars

Edit `wrangler.toml [vars]` or override in the Cloudflare Workers dashboard:

```toml
[vars]
NODE_ENV = "production"
CORS_ORIGIN = "https://your-dashboard.vercel.app"
API_BASE_URL = "https://agentpay-api.workers.dev"
FRONTEND_URL = "https://your-dashboard.vercel.app"
```

### 4 — Configure Hyperdrive (recommended)

Hyperdrive provides connection pooling between Workers and Supabase. Create the Hyperdrive config in the Cloudflare dashboard using the **Direct URL** (port 5432) as the source, then update `wrangler.toml`:

```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "<your-hyperdrive-id>"
```

### 5 — Deploy

```bash
npx wrangler deploy
```

Verify:
```bash
curl https://agentpay-api.workers.dev/health
# {"status":"active","timestamp":"...","services":{...},"version":"1.0.0"}
```

### 6 — Update Stripe webhook endpoint

In the Stripe dashboard, set the webhook endpoint to:
```
https://agentpay-api.workers.dev/webhooks/stripe
```

---

## Vercel Dashboard

The Next.js dashboard is deployed independently from the API.

1. Import the repository into Vercel.
2. Set the **Root Directory** to `dashboard`.
3. Set `AGENTPAY_API_BASE_URL` to your Workers deployment URL in the Vercel project settings.
4. Deploy.

The dashboard proxies all API calls via `AGENTPAY_API_BASE_URL`. Changing this variable is the single control that switches the dashboard between the Workers API and the legacy Render backend.

---

## Local Development

### Cloudflare Workers dev server

```bash
cd apps/api-edge
cp .dev.vars.example .dev.vars   # fill in your values
npx wrangler dev                  # Workers dev on :8787
```

### Legacy Node.js (full feature surface)

```bash
# In the repo root
npm ci
cp .env.production.example .env  # fill in values
docker-compose up -d             # or: node scripts/create-db.js
node scripts/migrate.js
npm run dev                      # API on :3001, dashboard on :3000
```

---

## Legacy Render Backend (transitional)

The original Express backend is still configured for Render via `render.yaml`. Render auto-runs migrations and manages a PostgreSQL database.

```
Build:  npm install --production=false && npx prisma generate && npm run build
Start:  node scripts/migrate.js && node dist/server.js
```

**Status:** Being decommissioned as the Cloudflare Workers migration completes. Do not invest in new Render-specific features. See `apps/api-edge/RENDER_RETIREMENT.md` for the full decommission checklist.

---

## Environment Variables

See [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) for the complete reference covering all surfaces: Workers secrets, `wrangler.toml` vars, `.dev.vars`, `.env`, and Vercel.

Generate strong secrets:

```bash
npm run generate:secrets
```

---

## Health Check

All surfaces expose a health endpoint:

```bash
# Workers
curl https://agentpay-api.workers.dev/health

# Legacy backend
curl https://your-render-service.onrender.com/health

# Local
curl http://localhost:8787/health   # Workers dev
curl http://localhost:3001/health   # Node.js dev
```

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for SLOs, metrics, runbooks, and on-call guidance.
