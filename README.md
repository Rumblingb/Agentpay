# AgentPay: Production-Ready HTTP 402 Payment Server for USDC on Solana

<p align="center">
  <a href="https://github.com/Rumblingb/Agentpay/blob/main/package.json"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
  <a href="https://github.com/Rumblingb/Agentpay/issues"><img src="https://img.shields.io/github/issues/Rumblingb/Agentpay" alt="Issues"></a>
  <a href="https://github.com/Rumblingb/Agentpay/stargazers"><img src="https://img.shields.io/github/stars/Rumblingb/Agentpay" alt="Stars"></a>
  <a href="https://github.com/Rumblingb/Agentpay/actions"><img src="https://img.shields.io/badge/tests-216%2F216%20passing-brightgreen" alt="Tests"></a>
  <a href="https://github.com/Rumblingb/Agentpay/blob/main/PRODUCTION_READINESS_REPORT.md"><img src="https://img.shields.io/badge/status-production%20ready-blueviolet" alt="Status"></a>
</p>

**Version 1.0** (Released February 24, 2026)
**Latest Update**: March 3, 2026 — Dashboard UI polish, security hardening, and Stripe webhook fixes

AgentPay is a secure, scalable HTTP 402 "Payment Required" server designed for merchants to handle USDC payments on Solana. It emphasizes fraud prevention through recipient address verification, audit logging, and production-grade features like rate limiting and webhook support. Built with TypeScript, Node.js, PostgreSQL (via Prisma), and Solana web3.js, it's optimized for AI agents and bots — enabling frictionless integration for both human developers and autonomous systems.

**Key highlights:**

- **Production Readiness** — 216/216 tests passing with 94% coverage. Hardened against unauthorized access (forced 403 responses), SQL injection, DDoS, and payment fraud.
- **Security Focus** — PBKDF2 API key hashing, Joi validation, Helmet headers, and critical recipient verification to prevent fake payments.
- **Integrations** — Moltbook-ready (spending policies, marketplace), Stripe fiat fallback, and SDKs for TypeScript/Python.
- **Performance** — <100ms API responses, 2+ block confirmations for Solana transactions, 99.95% uptime target.

See the [Whitepaper](AGENTPAY_WHITEPAPER--.md) for vision, architecture, and economics. AgentPay positions as the financial OS for AI agents, starting with Solana/USDC and expanding to multi-chain/fiat.

---

## Table of Contents

- [Features](#features)
- [Security Highlights](#security-highlights)
- [Architecture Overview](#architecture-overview)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Configuration](#configuration)
- [API Documentation](#api-documentation)
- [Frictionless Bot/Human Integration](#frictionless-bothuman-integration)
- [SDK Usage](#sdk-usage)
- [Webhooks](#webhooks)
- [Database Schema](#database-schema)
- [Testing](#testing)
- [Deployment](#deployment)
- [Production Hardening](#production-hardening)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

---

## Features

- **HTTP 402 Paywalls** — Require payments before granting access to APIs, content, or services.
- **USDC on Solana** — Instant, low-fee micropayments with sub-second settlements.
- **Fraud Prevention** — On-chain verification ensures payments go to the correct recipient wallet.
- **Merchant Management** — Registration, API keys, profiles, and stats.
- **Transaction Tracking** — Create, verify, list, and analyze payments with metadata support.
- **Audit Logging** — Full traceability for compliance and debugging.
- **Rate Limiting** — Per-IP and per-merchant to prevent abuse.
- **Dashboard** — React/Next.js interface for monitoring (deployed on Vercel).
- **Stripe Fallback** — For fiat settlements (USD payouts via webhooks).
- **Moltbook Integration** — Spending policies, agent discovery, and reputation (AgentRank).
- **Multi-Chain Ready** — Core on Solana, with PAL (Protocol Abstraction Layer) for future expansions.
- **Agent-Friendly** — Designed for bots — programmatic registration, policies, and payments.

---

## Security Highlights

AgentPay prioritizes security to production standards:

| Layer | Implementation |
|---|---|
| **Recipient Verification** | Prevents fraud by checking tx recipient matches merchant wallet |
| **API Authentication** | PBKDF2-hashed keys with salts; no recovery — generate once |
| **Input Validation** | Joi schemas for all endpoints |
| **Rate Limiting** | express-rate-limit (per IP/merchant) + Redis counters |
| **Headers & Protections** | Helmet for CSP/XSS, CORS restrictions |
| **Database Security** | Prisma with parameterized queries; encrypted PII |
| **Blockchain Checks** | 2+ confirmations, tx success validation via Solana RPC |
| **Logging** | All API calls and events in `api_logs` table; no PII in logs |

See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for the full security model.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                    Clients                       │
│         (Bots / Agents / Developers)             │
└──────────────┬───────────────────────────────────┘
               │  REST API
┌──────────────▼───────────────────────────────────┐
│         Node.js / Express Backend                │
│    (src/server.ts — auth, routes, middleware)     │
├──────────────┬───────────────┬───────────────────┤
│  Prisma ORM  │  Solana RPC   │  Stripe SDK       │
│  PostgreSQL  │  web3.js      │  Fiat fallback    │
└──────────────┴───────────────┴───────────────────┘
               │
┌──────────────▼───────────────────────────────────┐
│           Next.js Dashboard (Vercel)             │
│     Metrics · Charts · API Keys · Webhooks       │
└──────────────────────────────────────────────────┘
```

- **Backend**: Node.js/Express (`src/server.ts`), Prisma for DB.
- **Blockchain**: Solana web3.js for tx verification.
- **Database**: PostgreSQL with tables for merchants, transactions, logs.
- **Frontend**: Next.js dashboard for metrics, charts, and controls.
- **Queueing**: BullMQ/Redis for webhooks (reliable delivery with retries).
- **Deployment**: Render.com (`render.yaml`), Vercel for dashboard.
- **Testing**: Jest with integration/security suites.

---

## Dashboard

The AgentPay dashboard provides real-time monitoring of payments, merchant stats, and agent activity.

![Hero / Welcome Page](docs/screenshots/hero.png)
*Welcome page with glassmorphism UI, hero stats ($454 processed, 40 payments, 100% success rate)*

![Login Card](docs/screenshots/login.png)
*Login card with API key input and gradient styling*

![Dashboard](docs/screenshots/dashboard.png)
*Post-login dashboard with payment analytics, transaction history, and agent metrics*

<!-- Note: Add these screenshots to the pitch deck for investor presentations. -->

**Generate screenshots**: Run `npx tsx scripts/verify-ui.ts` to capture the latest dashboard UI.

---

## Recent Updates (March 2026)

- **UI Polish** — Merged glassmorphism and gradient styling into `login.tsx` and `index.tsx` for a modern dashboard aesthetic.
- **Stripe Idempotency** — Added webhook guard with idempotency checks in the Stripe webhook handler to prevent duplicate payment processing. `STRIPE_WEBHOOK_SECRET` now required in `.env`.
- **Trust Proxy Fix** — Added `app.set('trust proxy', 1)` in `server.ts` for correct IP resolution behind Render/Vercel reverse proxies.
- **Health Endpoint** — Enhanced `/health` to return `{ status, version, uptime, timestamp }` for monitoring.
- **OpenAPI Spec** — Added `docs/openapi.yaml` for API documentation.
- **Smoke Tests** — Added `scripts/smoke-test.sh` for quick verification of all key flows.
- **Deployment Check** — Added `scripts/deployment-check.sh` for production sanity checks.

---

## Quick Start

**Live Demo**: [https://apay-delta.vercel.app](https://apay-delta.vercel.app)

```bash
# 1. Clone the repo
git clone https://github.com/Rumblingb/Agentpay.git
cd Agentpay

# 2. Install dependencies
npm install

# 3. Set up environment (copy .env.example to .env)
cp .env.example .env
# Edit .env with your DATABASE_URL, SOLANA_RPC_URL, JWT_SECRET, etc.

# 4. Initialize database
npm run db:create
npm run db:migrate

# 5. Start server
npm run dev
```

Test the API immediately:

```bash
curl -X POST http://localhost:3000/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Merchant","email":"test@example.com","walletAddress":"YOUR_SOLANA_WALLET"}'
```

**Dashboard**: `cd dashboard && npm install && npm run dev` (runs on http://localhost:3001).

For a detailed walkthrough, see [QUICKSTART.md](QUICKSTART.md).

---

## Installation

### Prerequisites

- **Node.js** v20+
- **PostgreSQL** v12+ (free on Render)
- **Docker** (optional) — for local development via `docker-compose.yml`

### Dependencies

Key packages (from `package.json`): Express, Prisma, @solana/web3.js, Stripe, Joi, Helmet, express-rate-limit, BullMQ, Redis, Jest.

Full setup guide: [PRODUCTION_SETUP.md](PRODUCTION_SETUP.md).

---

## Configuration

Edit `.env` for production:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` (devnet) or mainnet URL |
| `JWT_SECRET` | Random secret (generate via `scripts/generate-key.ts`) |
| `STRIPE_WEBHOOK_SECRET` | For fiat off-ramps |
| `NODE_ENV` | `production` or `test` |

---

## API Documentation

All endpoints require `Authorization: Bearer YOUR_API_KEY` except registration.

### Merchant Routes

#### Register Merchant

```bash
POST /api/merchants/register
Content-Type: application/json

{
  "name": "My Business",
  "email": "business@example.com",
  "walletAddress": "9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo"
}
```

**Response:**
```json
{
  "success": true,
  "merchantId": "uuid",
  "apiKey": "your-secret-api-key",
  "message": "Store your API key securely. You will not be able to view it again."
}
```

#### Get Profile

```bash
GET /api/merchants/profile
Authorization: Bearer YOUR_API_KEY
```

#### Update Profile

```bash
PUT /api/merchants/profile
Authorization: Bearer YOUR_API_KEY
```

### Payment Routes

#### Create Payment Request

```bash
POST /api/merchants/payments
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "amountUsdc": 100,
  "recipientAddress": "9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo",
  "metadata": { "userId": "user123", "contentId": "article42" },
  "expiryMinutes": 30
}
```

**Response:**
```json
{
  "success": true,
  "transactionId": "uuid",
  "paymentId": "x402_1708123456_abc123",
  "amount": 100,
  "recipientAddress": "9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo",
  "instructions": "Send USDC to the recipient address within the expiry time"
}
```

#### Verify Payment ⚠️

```bash
POST /api/merchants/payments/{paymentId}/verify
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{ "transactionHash": "5J7KvB8mN2...full_solana_tx_hash" }
```

**Security checks performed:**
1. Transaction exists on-chain
2. Recipient address matches merchant wallet
3. Transaction succeeded
4. Confirmation depth ≥ 2 blocks

#### Get / List / Stats

```bash
GET /api/merchants/payments/{paymentId}       # Single payment
GET /api/merchants/payments?limit=50&offset=0  # List with stats
GET /api/merchants/stats                       # Aggregate stats
```

### Moltbook / Agent Routes

```bash
POST /api/moltbook/bots/register                       # Bot self-registers
PUT  /api/moltbook/bots/{handle}/spending-policy       # Set spending policies
GET  /api/moltbook/marketplace/services                # Discover services (AgentRank)
POST /api/moltbook/bots/{handle}/pause                 # Emergency pause
```

Error responses are standardized: 400 (validation), 401 (unauthorized), 403 (forbidden), 429 (rate limit).

### Moltbook-Ready Endpoints

#### Register a Bot

```bash
curl -X POST http://localhost:3001/api/moltbook/bots/register \
  -H "Content-Type: application/json" \
  -d '{
    "handle": "@MyResearchBot",
    "display_name": "Research Bot",
    "primary_function": "research",
    "bio": "Finds and summarizes academic papers"
  }'
```

**Response:**
```json
{
  "success": true,
  "botId": "uuid",
  "handle": "@MyResearchBot",
  "apiKey": "bot-api-key"
}
```

#### Update Spending Policy

```bash
curl -X PATCH http://localhost:3001/api/moltbook/bots/BOT_ID/spending-policy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "dailySpendingLimit": 100,
    "perTxLimit": 25,
    "autoApproveUnder": 5,
    "alertWebhookUrl": "https://example.com/alerts"
  }'
```

**Response:**
```json
{
  "success": true,
  "policy": {
    "dailySpendingLimit": 100,
    "perTxLimit": 25,
    "autoApproveUnder": 5,
    "alertWebhookUrl": "https://example.com/alerts"
  }
}
```

See [docs/openapi.yaml](docs/openapi.yaml) for the full OpenAPI specification.

---

## Frictionless Bot/Human Integration

AgentPay is built to be seamless for both human developers and autonomous AI agents:

- **API Keys** — Generated at registration; bots can register programmatically.
- **SDKs** — TypeScript and Python for one-line integrations (see `sdk/`).
- **Webhooks** — Real-time notifications for transaction status changes.
- **Bot-Friendly** — No CAPTCHA/KYC; spending policies allow autonomous operation.
- **Examples** — Ready-to-run for cURL, Node.js, Python, and agent frameworks (see `examples/`).

**Human Developer**: Use the dashboard for real-time monitoring and management.
**Bot / Agent**: Call register → pay → verify directly in your agent workflow.

---

## SDK Usage

### TypeScript

```typescript
import { AgentPayClient } from 'agentpay-sdk';

const client = new AgentPayClient({ apiKey: 'YOUR_KEY' });

async function payForService() {
  const payment = await client.createPayment({
    amountUsdc: 10,
    recipient: 'MERCHANT_WALLET',
    metadata: { botId: 'my-agent' }
  });

  // Bot performs Solana tx...
  const txHash = 'SOLANA_TX_HASH';

  const verified = await client.verifyPayment(payment.paymentId, txHash);
  if (verified) console.log('Access granted!');
}
```

### Python

```python
from agentpay_sdk import AgentPayClient

client = AgentPayClient(api_key='YOUR_KEY')

payment = client.create_payment(amount_usdc=10, recipient='MERCHANT_WALLET')
# ... Send tx ...
verified = client.verify_payment(payment['paymentId'], 'TX_HASH')
```

See [`sdk/`](sdk/) for full SDK documentation and examples.

---

## Webhooks

Configure via `.env` (`WEBHOOK_URL`). Supported events: `payment.created`, `payment.confirmed`, `payment.failed`.

```typescript
app.post('/webhook', (req, res) => {
  if (verifyWebhook(req.body)) {
    // Handle event
    res.status(200).send();
  } else {
    res.status(400).send();
  }
});
```

BullMQ ensures reliable delivery with retries.

---

## Database Schema

From Prisma (`prisma/schema.prisma`):

| Table | Purpose |
|---|---|
| `merchants` | id (uuid), name, email (unique), api_key_hash/salt, wallet_address (unique), is_active, timestamps |
| `transactions` | id (uuid), merchant_id (fk), payment_id (unique), amount_usdc (decimal), recipient/payer_address, tx_hash, status (enum), confirmation_depth, metadata (jsonb), expires_at, timestamps |
| `api_logs` | Audit trail of all API calls |
| `rate_limit_counters` | IP + merchant rate limiting |
| `payment_verifications` | Secure verification tokens |
| `webhook_events` | Merchant notifications |

Migrate: `npm run db:migrate`.

---

## Testing

```bash
npm test                    # Run all tests (216 passing)
npm test -- --coverage      # Run with coverage (94%)
npm run test:security       # Security tests only
npm run test:watch          # Watch mode
```

Test suites cover: authentication, payments, verification, recipient checks, input validation, rate limiting, and end-to-end flows.

---

## Deployment

| Platform | Target | Config |
|---|---|---|
| **Render.com** | Backend API | `render.yaml` — auto-detects, add env vars |
| **Vercel** | Dashboard | `cd dashboard && vercel --prod` |
| **Docker** | Local / prod | `docker-compose up` |
| **CI/CD** | GitHub Actions | `.github/workflows/ci.yml` |

See [DEPLOYMENT.md](DEPLOYMENT.md) for full instructions.

---

## Production Hardening

Already implemented or in progress:

- [x] Recipient address verification (critical)
- [x] API key authentication (PBKDF2)
- [x] Rate limiting (per IP + per merchant)
- [x] Input validation (Joi)
- [x] SQL injection prevention (parameterized queries)
- [x] CORS protection
- [x] Helmet security headers
- [x] Audit logging
- [x] Transaction locking (race condition prevention)
- [x] Confirmation depth checking (2+ blocks)
- [x] Trust proxy for Render deployments
- [x] Forced 403 on unauthorized intents
- [ ] Env validation (envalid)
- [ ] Structured logging (Winston/Morgan)
- [ ] Monitoring (Sentry/Prometheus)
- [ ] PM2 clustering for scaling
- [ ] Automated DB backups
- [ ] SOC 2 compliance (in progress)

See [PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md) for the full report.

---

## Roadmap

| Phase | Milestone | Status |
|---|---|---|
| **Q1 2026** | Core HTTP 402 server, USDC on Solana, dashboard, 216 tests | ✅ Complete |
| **Q2 2026** | OpenAPI spec, multi-chain PAL, hosted agent wallets | 🔄 In progress |
| **Q3 2026** | Fiat on/off-ramps, compliance toolkit, enterprise tier | 📋 Planned |
| **Q4 2026** | Global expansion, marketplace v2, AgentRank scoring | 📋 Planned |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Run tests before submitting (`npm test`)
4. Open a Pull Request

---

## License

[MIT](https://opensource.org/licenses/MIT)

---

## Support

- **Issues**: [GitHub Issues](https://github.com/Rumblingb/Agentpay/issues)
- **Docs**: [QUICKSTART.md](QUICKSTART.md) · [Whitepaper](AGENTPAY_WHITEPAPER--.md) · [Production Setup](PRODUCTION_SETUP.md)
- **Contact**: rajivbaskaran@gmail.com

---

<p align="center">
  <strong>AgentPay</strong> — The financial OS for AI agents.<br>
  Built with a security-first approach. Recipient address verification prevents payment fraud.
</p>