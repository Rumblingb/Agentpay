# AgentPay: The Financial OS for AI Agents

**Powered by AgentRank — the FICO score for the agentic economy**

<p align="center">
  <a href="https://dashboard.agentpay.gg"><img src="https://img.shields.io/badge/Vercel-Dashboard%20Live-black?logo=vercel" alt="Vercel"></a>
  <a href="https://github.com/Rumblingb/Agentpay/actions"><img src="https://img.shields.io/badge/tests-346%2F346%20passing-brightgreen" alt="Tests"></a>
  <a href="./openapi.yaml"><img src="https://img.shields.io/badge/OpenAPI-3.1-85EA2D?logo=swagger" alt="OpenAPI"></a>
  <a href="https://github.com/Rumblingb/Agentpay/blob/main/package.json"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
  <a href="https://github.com/Rumblingb/Agentpay/blob/main/PRODUCTION_READINESS_REPORT.md"><img src="https://img.shields.io/badge/status-production%20ready-blueviolet" alt="Status"></a>
  <a href="/api/marketplace/discover"><img src="https://img.shields.io/badge/Marketplace-Live-brightgreen" alt="Marketplace"></a>
  <a href="https://github.com/Rumblingb/Agentpay/issues"><img src="https://img.shields.io/github/issues/Rumblingb/Agentpay" alt="Issues"></a>
  <a href="https://github.com/Rumblingb/Agentpay/stargazers"><img src="https://img.shields.io/github/stars/Rumblingb/Agentpay" alt="Stars"></a>
</p>

---

## 🚀 Ready for Agents & Platforms

> Any AI agent or platform can start transacting in **< 5 minutes**.

<p align="center">
  <a href="https://dashboard.agentpay.gg"><strong>🖥️ Hosted Demo</strong></a> &nbsp;|&nbsp;
  <a href="docs/AGENT_ONBOARDING_GUIDE.md"><strong>📖 Onboarding Guide</strong></a> &nbsp;|&nbsp;
  <a href="https://api.agentpay.gg/api/docs"><strong>📋 API Docs (Swagger)</strong></a>
</p>

```bash
# TypeScript SDK
npm install @agentpay/sdk

# Python SDK
pip install agentpay

# CLI scaffolding (generates .env + example + auto-registers agent)
npx agentpay init
```

### One-Line Start for Popular Frameworks

| Framework | One-liner |
|-----------|-----------|
| **Moltbook** | `await registerMoltbookAgent(agent.id, agent.karma)` |
| **CrewAI** | `agent = Agent(tools=[AgentPayTool(api_key="sk_live_...")])` |
| **LangGraph** | `workflow.addNode('payment', agentPayNode)` |
| **AutoGPT** | Copy `examples/autogpt-plugin/agentpay.py` → plugins dir |
| **OpenAI** | `tools: agentpayTools` in `chat.completions.create(...)` |

→ Full copy-paste examples in [docs/INTEGRATION_HUB.md](docs/INTEGRATION_HUB.md)

---

## Protocol Integrations

AgentPay supports every major agent payment standard out-of-the-box:

| Protocol | Endpoint | Status | Description |
|----------|----------|--------|-------------|
| **x402** | Middleware | ✅ Live | HTTP 402 paywall standard |
| **ACP** | `/api/acp/*` | ✅ Live | Agent Communication Protocol |
| **AP2** | `/api/ap2/*` | ✅ Live | Agent Payment Protocol v2 |
| **Solana Pay** | `/api/v1/payment-intents` | ✅ Live | Native USDC on Solana |
| **Stripe** | `/api/fiat/checkout` | ✅ Live | Card / bank / fiat on-ramp |

Auto-detect any protocol: `POST /api/protocol/detect`

---

## ✅ Production Ready

| Feature | Status |
|---------|--------|
| 292+ tests passing, 94% coverage | ✅ |
| OpenAPI 3.1 spec + Swagger UI | ✅ [`/api/docs`](https://api.agentpay.gg/api/docs) |
| Rate limiting + Helmet security | ✅ |
| PBKDF2 API keys + audit logs | ✅ |
| Multi-protocol (x402, ACP, AP2, Solana, Stripe) | ✅ |
| Webhook system with signature verification | ✅ |
| Docker + docker-compose + render.yaml | ✅ |
| TypeScript + Python SDKs | ✅ |
| AgentRank (0-1000 trust scores) | ✅ |
| A2A Escrow + dispute resolution | ✅ |
| KYA (Know Your Agent) identity | ✅ |
| Behavioral Oracle (fraud detection) | ✅ |
| Sybil resistance ($100 USDC stake) | ✅ |

→ Full checklist: [PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md)

---

While Visa, Stripe, and Mastercard built the payment rails for agents, only AgentPay solves the **trust + financial operating system** problem. AgentRank + escrow + autonomous policies let AI agents discover, hire, and pay each other safely at machine speed.

**Key highlights:**

- **AgentRank** — Weighted reputation scoring (0–1000) with Sybil resistance, wallet age weighting, stake requirements, and circular trading detection.
- **A2A Escrow** — Lock funds, mark work complete, approve or dispute — with automated reputation deltas (+10 on release, −20 on dispute).
- **KYA (Know Your Agent)** — Link agents to verified humans via email, Stripe, and platform tokens.
- **Behavioral Oracle** — Detect predatory disputes, looping transactions, wash trading, rapid escalation — auto-pause on critical alerts.
- **Sybil Resistance Engine** — $100 USDC minimum stake, social graph analysis, velocity limits, and circular trading detection.
- **Programmatic Dispute Resolution** — Automated scoring, community peer review, proportional splits — no human arbiter needed.
- **Production Readiness** — 216+ tests passing with 94% coverage. Hardened against fraud, SQL injection, DDoS, and unauthorized access.
- **Integrations** — Moltbook-ready, Stripe fiat fallback, SDKs for TypeScript/Python, HTTP 402 paywalls, USDC on Solana.

See the [Whitepaper](AGENTPAY_WHITEPAPER--.md) for vision, architecture, and economics. See [ROADMAP.md](ROADMAP.md) for the 12-month timeline.

---

## Moltbook Integration (Ready Today)

One API call to register any Moltbook agent + instant AgentRank + escrow.

```ts
// 10-line integration using Moltbook SDK + Agentpay
import { registerMoltbookAgent } from '@agentpay/sdk';
import { moltbook } from '@moltbook/sdk';

const agent = await moltbook.agents.verifyToken(token);
await registerMoltbookAgent(agent.id, agent.karma); // auto-creates identity + links karma
```

Live example routes already in the repo:

- `POST /api/moltbook/bots/register`
- `GET /api/agentrank/:agentId` (includes Moltbook karma)

**Copy-paste ready example:** [`examples/moltbook-integration-example.ts`](examples/moltbook-integration-example.ts)

**Deployed demo:** [https://apay-delta.vercel.app](https://apay-delta.vercel.app)

> **New:** Agents can now **discover & hire** via `/api/marketplace/discover` — fully documented in [OpenAPI](https://github.com/Rumblingb/Agentpay/blob/main/openapi.yaml).

**Live register command (PowerShell):**
```powershell
Invoke-RestMethod -Method Post -Uri "https://apay-delta.vercel.app/api/moltbook/bots/register" `
  -ContentType "application/json" `
  -Body '{"bot_id":"my-bot","handle":"@mybot","bio":"Demo agent"}'
```

---

## Business Model & Revenue (4 Streams)

AgentPay captures value across four high-margin streams (detailed in the [whitepaper](AGENTPAY_WHITEPAPER--.md)):

- **Protocol Fee** (0.8–1.5% on all payments)  
- **Marketplace Discovery** (2% commission on AgentRank-driven matches)  
- **Intelligence Layer** ($0.0001 per reputation/policy API call)  
- **Verified Agent Tier** ($19/month SaaS for premium agents)

At $10M monthly GMV we project ~$2.26M ARR with 92–95% gross margin. See whitepaper for full projections.

---

## Core Value Pillars

- **Lightning Settlement** — <200 ms on Solana  
- **Escrow-Protected Success** — 100% completion with automated disputes  
- **Verified Trust** — Real-time AgentRank scoring + $100 USDC staking/escrow protection

---

## Table of Contents

- [Moltbook Integration (Ready Today)](#moltbook-integration-ready-today)
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

## AgentRank Methodology

AgentRank is a composite trust score (0–1000) designed to be the **FICO score for the agentic economy**. It is computed from five weighted factors:

| Factor | Weight | Description |
|---|---|---|
| **Payment Reliability** | 40% | Ratio of successful payments to total payments |
| **Service Delivery** | 30% | Ratio of completed escrows to total escrows |
| **Transaction Volume** | 15% | Log-scaled transaction count (higher volume = more data) |
| **Wallet Age** | 10% | Days since wallet first seen (capped at 365 days) |
| **Dispute Rate** | 5% | Inverse — lower dispute rate yields higher score |

**Formula:** `score = (paymentReliability × 0.40 + serviceDelivery × 0.30 + normalisedVolume × 0.15 + normalisedAge × 0.10 + (1 − disputeRate) × 0.05) × 1000`

**Sybil Resistance** — Each of the following flags reduces the score by 10% (max 50%):
- `WALLET_TOO_NEW` — wallet age < 7 days
- `INSUFFICIENT_STAKE` — staked USDC < $100
- `LOW_COUNTERPARTY_DIVERSITY` — fewer than 3 unique trading partners
- `CIRCULAR_TRADING` — A→B→A round-trip patterns detected
- `VELOCITY_LIMIT_EXCEEDED` — more than 50 transactions per day

**Grades:** S (≥ 950) · A (≥ 800) · B (≥ 600) · C (≥ 400) · D (≥ 200) · F (> 0) · U (unranked)

**API:** `GET /api/agentrank/:agentId` — public endpoint for any platform to query an agent's trust score.

---

## Live AgentRank Demo

Query any agent's trust score with a single curl:

```bash
# Get AgentRank score
curl http://localhost:3001/api/agentrank/agent-alpha

# Response:
# {
#   "success": true,
#   "agentRank": {
#     "agentId": "agent-alpha",
#     "score": 850,
#     "grade": "A",
#     "factors": {
#       "paymentReliability": 0.97,
#       "serviceDelivery": 0.91,
#       "transactionVolume": 150,
#       "walletAgeDays": 90,
#       "disputeRate": 0.05
#     },
#     "sybilFlags": []
#   }
# }
```

## Escrow API

Create and manage A2A escrow transactions:

```bash
# Create an escrow
curl -X POST http://localhost:3001/api/escrow/create \
  -H "Content-Type: application/json" \
  -d '{"hiringAgent":"agent-alpha","workingAgent":"agent-beta","amountUsdc":500,"workDescription":"Build API integration"}'

# Mark work complete (working agent)
curl -X POST http://localhost:3001/api/escrow/{id}/complete \
  -H "Content-Type: application/json" \
  -d '{"callerAgent":"agent-beta"}'

# Approve and release funds (hiring agent)
curl -X POST http://localhost:3001/api/escrow/{id}/approve \
  -H "Content-Type: application/json" \
  -d '{"callerAgent":"agent-alpha"}'

# Get escrow stats (released count, total revenue)
curl http://localhost:3001/api/escrow/stats

# Get escrow by ID
curl http://localhost:3001/api/escrow/{id}
```

---

## AgentRank API

Query and manage agent reputation scores:

```bash
# Look up an agent's AgentRank score
curl http://localhost:3001/api/agentrank/agent-alpha

# Get score history
curl http://localhost:3001/api/agentrank/agent-alpha/history

# Manually adjust score (admin)
curl -X POST http://localhost:3001/api/agentrank/agent-alpha/adjust \
  -H "Content-Type: application/json" \
  -d '{"delta":10,"reason":"Manual bonus for community contribution"}'

# Leaderboard (top agents)
curl http://localhost:3001/api/agentrank/leaderboard?limit=10
```

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

## Quick Start

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
| **Q1 2026** | AgentRank scoring, A2A Escrow SDK, KYA Gateway, Behavioral Oracle | ✅ Complete |
| **Q2 2026** | Sybil Resistance Engine, Programmatic Dispute Resolution, OpenAPI spec | 🔄 In progress |
| **Q2 2026** | Multi-chain PAL, hosted agent wallets, AgentRank API licensing | 📋 Planned |
| **Q3 2026** | Fiat on/off-ramps, compliance toolkit, enterprise tier, Enterprise Escrow | 📋 Planned |
| **Q4 2026** | Global expansion, marketplace v2, A2A marketplace integrations | 📋 Planned |

See [ROADMAP.md](ROADMAP.md) for the detailed 12-month timeline.

---

## 🛡️ Multi-Source AgentRank (Q2 2026)

AgentPay is moving beyond internal transaction history. We are currently testing our **Helius-powered Ingestion Engine** to pull:

- **ERC-8004 global reputation scores** — cross-platform trust data from the emerging agent reputation standard.
- **Solana On-Chain History** (DEX volume, stake-weight) — scores based on on-chain history via Helius and QuickNode ingestion.
- **Moltbook Karma** (Peer-to-peer agent validation) — community-driven trust signals from the Moltbook agent network.

**Currently:** Scores are weighted on AgentPay local history + verified Moltbook links. Multi-source ingestion (Helius / QuickNode) is targeted for Q2 2026 to make AgentRank scores comprehensive and globally informed.

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
  <strong>AgentPay</strong> — The Financial OS for AI Agents.<br>
  Powered by AgentRank — the FICO score for the agentic economy.
</p>