# Operations — AgentPay

> **Version:** 1.0  
> **Last Updated:** 2026-03-10  
> **Owner:** Engineering / Platform

---

## Health Checks

| Endpoint | Purpose | Expected Response |
|----------|---------|------------------|
| `GET /health` | Liveness check | `200 { "status": "ok" }` |
| `GET /api/health` | API health | `200 { "status": "ok", "version": "..." }` |
| `GET /metrics` | Prometheus metrics | Text format metrics |

**Known gap:** The `/health` endpoint currently returns 200 even if the database is unreachable. A proper readiness check should query the database.

---

## Observability

### Structured Logging

All logs are structured JSON (Pino):
```json
{
  "level": 30,
  "time": 1700000000000,
  "pid": 1234,
  "hostname": "...",
  "type": "http",
  "requestId": "uuid",
  "method": "POST",
  "path": "/api/v1/payment-intents",
  "status": 200,
  "durationMs": 45,
  "ip": "1.2.3.4"
}
```

**Log levels:**
- `error` (50) — Unhandled exceptions, startup failures
- `warn` (40) — Validation failures, security warnings
- `info` (30) — Normal operations (HTTP requests, service starts)
- `debug` (20) — Detailed debugging (disabled in production)

### Request IDs

Every request gets a `requestId` (UUID) attached by `src/middleware/logging.ts`. The ID is:
- Added to the response as `X-Request-Id` header
- Included in all log lines for the duration of the request
- Propagated to webhook deliveries

### Prometheus Metrics (`GET /metrics`)

Key metrics tracked:

| Metric | Type | Description |
|--------|------|-------------|
| `http_requests_total` | Counter | Total HTTP requests by method/path/status |
| `http_request_duration_ms` | Histogram | Request latency |
| `payment_intents_created_total` | Counter | Payment intents created |
| `escrow_transactions_total` | Counter | Escrow operations |
| `agentrank_adjustments_total` | Counter | Score adjustments |
| `webhook_deliveries_total` | Counter | Webhook delivery attempts |
| `webhook_delivery_errors_total` | Counter | Failed webhook deliveries |

### Error Tracking

Sentry integration is optional. Set `SENTRY_DSN` environment variable to enable.

---

## Key Operational Metrics

Define SLOs around these:

| Metric | Target SLO | Alert Threshold |
|--------|------------|-----------------|
| Payment success rate | ≥99.5% | <99% |
| Escrow completion rate | ≥95% | <90% |
| Dispute rate | ≤3% | >5% |
| API p99 latency | ≤500ms | >1000ms |
| Webhook delivery success | ≥99% | <95% |
| Reconciliation lag | ≤5 min | >15 min |

---

## Background Jobs

### Reconciliation Daemon (`src/services/reconciliationDaemon.ts`)

**Purpose:** Detect anomalies between payment intents, transactions, and on-chain state  
**Trigger:** Starts automatically on server startup (unless `RECONCILIATION_DISABLED=true`)  
**Interval:** Configurable via `RECONCILIATION_INTERVAL_MS`  
**Failure mode:** Logs errors and continues; no circuit breaker currently  

**Known gap:** No dead-letter queue for failed reconciliation runs. Failed runs log errors but do not alert.

### Webhook Delivery Worker (`src/services/webhookDeliveryWorker.ts`)

**Purpose:** Deliver webhook events to merchant endpoints with retry  
**Trigger:** Event emission via `webhookEmitter.ts`  
**Retry policy:** Exponential backoff, max 3 retries  
**Failure mode:** After max retries, event is marked as failed in `webhook_events`

### Solana Listener (`src/services/solana-listener.ts`)

**Purpose:** Poll Solana RPC for transaction confirmations  
**Trigger:** Starts automatically on server startup  
**Network:** Devnet (testnet); mainnet requires additional configuration  

---

## Deployment

### Render (Production)

```yaml
# render.yaml
buildCommand: npm install --production=false && npx prisma generate && npm run build
startCommand: node scripts/migrate.js && node dist/server.js
```

Database migrations run automatically on every deploy.

### Environment Variables (Required in Production)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://...` |
| `DIRECT_URL` | Direct PostgreSQL URL (for Prisma) | `postgresql://...` |
| `WEBHOOK_SECRET` | HMAC secret for webhook signing | 32+ random bytes |
| `AGENTPAY_SIGNING_SECRET` | Wallet encryption key | 32+ random bytes |
| `VERIFICATION_SECRET` | JWT signing secret | 32+ random bytes |
| `STRIPE_SECRET_KEY` | Stripe API key | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | `whsec_...` |
| `SOLANA_RPC_URL` | Solana RPC endpoint | `https://api.mainnet-beta.solana.com` |

Generate secrets: `npm run generate:secrets`

### Environment Variables (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port |
| `CORS_ORIGIN` | None | Allowed CORS origin(s), comma-separated |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Global rate limit per 15 min |
| `SENTRY_DSN` | None | Sentry error tracking DSN |
| `LIQUIDITY_BOT_ENABLED` | `true` | Enable liquidity cron |
| `ADMIN_SECRET_KEY` | None | Admin endpoint secret |

---

## Runbooks

### Runbook: Database Connection Failures

1. Check PostgreSQL service status in Render dashboard
2. Verify `DATABASE_URL` is set and correct
3. Check connection pool exhaustion in `/metrics` (`pg_pool_*` metrics)
4. Restart service if pool is exhausted

### Runbook: High Error Rate

1. Check Sentry (if enabled) for error clusters
2. Review logs: `grep '"level":50' production.log | tail -100`
3. Check if a recent deployment caused the regression
4. Roll back deployment if needed

### Runbook: Webhook Delivery Failures

1. Check `webhook_events` table for failed entries:
   ```sql
   SELECT * FROM webhook_events WHERE status = 'failed' ORDER BY created_at DESC LIMIT 20;
   ```
2. Verify the merchant's webhook endpoint is reachable
3. Check WEBHOOK_SECRET is set correctly
4. Manually replay failed events via admin API (planned)

### Runbook: Stale Reconciliation

1. Check `RECONCILIATION_DISABLED` env var
2. Check daemon logs for errors
3. Manually trigger reconciliation via admin API (planned)

---

## On-Call Expectations

**Severity P1 (Active breach or fund loss):**
- Respond within 15 minutes
- Immediate containment (rotate secrets, disable affected keys)
- Notify engineering lead

**Severity P2 (Service degradation, auth failures):**
- Respond within 1 hour
- Diagnose and patch or roll back

**Severity P3 (Non-critical issues):**
- Address within next business day
