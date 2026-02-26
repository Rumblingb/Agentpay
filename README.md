# AgentPay — Universal Payment Gateway for AI Agents

A production-ready payment server implementing the HTTP 402 Payment Required flow with USDC on Solana, webhook delivery, Stripe Connect fiat rail, and comprehensive security controls.

---

## 🔒 Security Highlights

| Feature | Status |
|---|---|
| Recipient address verification (on-chain) | ✅ |
| PBKDF2 API key hashing | ✅ |
| Webhook SSRF protection | ✅ |
| Rate limiting (global + per-endpoint) | ✅ |
| Input validation (Joi) | ✅ |
| SQL injection prevention (prepared statements) | ✅ |
| CORS + Helmet security headers | ✅ |
| HMAC-signed verification certificates | ✅ |
| Append-only payment audit log | ✅ |
| Circuit breaker for Solana RPC | ✅ |
| Startup env-var validation | ✅ |

---

## 🚀 Quick Start

### Prerequisites
- Node.js ≥ 20
- PostgreSQL ≥ 12
- (Optional) Solana mainnet/devnet account with USDC

### Installation

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL, VERIFICATION_SECRET, WEBHOOK_SECRET, etc.

# 3. Initialise the database (creates all tables)
npm run db:create

# 4. Apply incremental migrations
npm run db:migrate

# 5. Start the development server (hot-reload)
npm run dev
```

---

## ⚙️ Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `VERIFICATION_SECRET` | ✅ | — | HMAC secret for payment certificates (≥ 32 random bytes) |
| `WEBHOOK_SECRET` | ✅ | — | HMAC secret for outbound webhook signatures (≥ 32 random bytes) |
| `PORT` | | `3001` | HTTP listen port |
| `NODE_ENV` | | `development` | `development` / `production` / `test` |
| `SOLANA_RPC_URL` | | `https://api.devnet.solana.com` | **Use a mainnet RPC in production** |
| `CONFIRMATION_DEPTH` | | `2` | Minimum block confirmations before a payment is accepted |
| `CORS_ORIGIN` | | `http://localhost:3000` | Allowed CORS origin(s), comma-separated |
| `RATE_LIMIT_WINDOW_MS` | | `900000` | Global rate-limit window in ms (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | | `100` | Max requests per window per IP |
| `STRIPE_SECRET_KEY` | | — | Stripe secret key (only needed for Stripe Connect features) |
| `STRIPE_WEBHOOK_SECRET` | | — | Stripe webhook signing secret |
| `APP_BASE_URL` | | `http://localhost:3001` | Public base URL (used for Stripe return URLs) |

> **Security note**: the server will print a warning at startup if `VERIFICATION_SECRET` or `WEBHOOK_SECRET` is unset or still using the default placeholder.

Generate secure secrets with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 📊 Database Schema

### Core tables

| Table | Purpose |
|---|---|
| `merchants` | Merchant accounts, PBKDF2-hashed API keys, Solana wallet address |
| `transactions` | Payment requests and their on-chain verification state |
| `payment_intents` | Orchestration-layer payment intents (Prisma-managed) |
| `payment_audit_log` | Append-only record of every verification attempt (AML compliance) |
| `verification_certificates` | HMAC-signed certificates issued on confirmed payments |
| `webhook_events` | Outbound webhook delivery log with retry state |
| `webhook_subscriptions` | V2 webhook subscriptions per merchant |
| `webhook_delivery_logs` | Per-attempt V2 webhook delivery records |
| `agent_reputation` | Trust scores for AI agent identities |
| `merchant_invoices` | 2 % platform-fee invoices per confirmed payment |

---

## 🔌 API Reference

All endpoints that require authentication use `Authorization: Bearer <api_key>`.

### Merchant

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/merchants/register` | — | Register a new merchant |
| `GET` | `/api/merchants/profile` | ✅ | Get merchant profile |
| `POST` | `/api/merchants/payments` | ✅ | Create a payment request |
| `POST` | `/api/merchants/payments/:id/verify` | ✅ | Verify an on-chain payment |
| `GET` | `/api/merchants/payments/:id` | ✅ | Get a single payment |
| `GET` | `/api/merchants/payments` | ✅ | List payments + stats |
| `GET` | `/api/merchants/stats` | ✅ | Merchant statistics |
| `POST` | `/api/merchants/rotate-key` | ✅ | Rotate API key |
| `GET` | `/api/merchants/invoices` | ✅ | List platform-fee invoices |
| `POST` | `/api/merchants/stripe/connect` | ✅ | Start Stripe Connect onboarding |

### Payment Intents (Orchestration Layer)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/intents` | ✅ | Create a payment intent |
| `GET` | `/api/intents/:id` | ✅ | Get intent status |
| `POST` | `/api/intents/:id/verify` | ✅ | Verify intent payment |

### v1 Agent API

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/payment-intents` | ✅ | Create intent (agent-facing) |
| `GET` | `/api/v1/payment-intents/:id` | ✅ | Get intent (agent-facing) |
| `POST` | `/api/v1/verify-payment` | ✅ | Standalone verify (no intent) |

### Webhooks

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/webhooks/subscriptions` | ✅ | Subscribe to events |
| `GET` | `/api/webhooks/subscriptions` | ✅ | List subscriptions |
| `DELETE` | `/api/webhooks/subscriptions/:id` | ✅ | Remove subscription |

### Agents & Reputation

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/agents/:agentId/reputation` | ✅ | Get agent trust score |
| `POST` | `/api/agents/:agentId/reputation` | ✅ | Update agent trust score |

### System

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | — | Health check |
| `GET` | `/api/protected` | — | Demo 402 resource |

---

## 🧪 Testing

```bash
# Run all tests (unit + integration)
npm test

# Security tests only
npm run test:security

# Watch mode
npm run test:watch

# Full integration tests (requires Docker)
npm run test:full
```

Integration and E2E tests require a PostgreSQL database. Start one with:

```bash
docker-compose up -d
```

The test database is automatically initialised when running `npm run test:full`.

### Current test coverage

| Suite | Status |
|---|---|
| Unit — billing service | ✅ Pass |
| Unit — certificate service | ✅ Pass |
| Unit — intent service | ✅ Pass |
| Unit — Stripe Connect | ✅ Pass |
| Unit — v1 intents | ✅ Pass |
| Security — address validation, circuit breaker, SSRF | ✅ Pass |
| Webhooks API | ✅ Pass |
| Stripe webhooks | ✅ Pass |
| Integration (requires DB) | DB required |
| E2E (requires DB) | DB required |

---

## ⚠️ Recipient Address Verification

**This is the single most important security control.**

When a merchant calls `/verify`, the server:
1. Fetches the transaction from the Solana blockchain via the configured RPC node
2. Parses all SPL-token `transfer` instructions
3. **Verifies** the destination matches the merchant's registered wallet address
4. Checks that `confirmationDepth ≥ CONFIRMATION_DEPTH` (default: 2 blocks)
5. Issues a signed HMAC certificate on success

### Attack scenario prevented

```
❌ Without verification:
  1. Attacker sends USDC to their own wallet
  2. Submits that tx hash to your server
  3. Server grants access — you never got paid

✅ With AgentPay:
  1. Attacker sends USDC to their own wallet
  2. Submits tx hash to AgentPay
  3. Server checks on-chain: destination ≠ merchant wallet
  4. Request rejected with 400
```

---

## 🚢 Production Deployment

### Docker / Render

A `render.yaml` and `docker-compose.yml` are included. Set all required environment variables in your platform's secrets manager before deploying.

Minimum checklist before going live:

- [ ] Set `NODE_ENV=production`
- [ ] Set `SOLANA_RPC_URL` to a reliable **mainnet** endpoint
- [ ] Set `VERIFICATION_SECRET` to ≥ 32 random bytes (not the placeholder)
- [ ] Set `WEBHOOK_SECRET` to ≥ 32 random bytes (not the placeholder)
- [ ] Set `DATABASE_URL` to your production database
- [ ] Set `CORS_ORIGIN` to your actual frontend domain
- [ ] Configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` if using fiat rail
- [ ] Run `npm run db:create && npm run db:migrate` against the production database
- [ ] Set up log aggregation (Pino outputs structured JSON)

---

## 📄 License

MIT
