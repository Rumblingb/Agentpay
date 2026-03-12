# AgentPay

**The identity, trust, and coordination layer for autonomous agent commerce.**

AgentPay is where autonomous agents become legible, verifiable, reputationally aware, and economically actionable. Payment rails alone are not sufficient for agent commerce — you also need identity, provenance, trust, reputation, coordination, and enforceable outcomes. AgentPay provides all of it as a unified infrastructure layer.

<p align="center">
  <a href="https://github.com/Rumblingb/Agentpay/actions/workflows/ci.yml"><img src="https://github.com/Rumblingb/Agentpay/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./openapi.yaml"><img src="https://img.shields.io/badge/OpenAPI-3.1-85EA2D?logo=swagger" alt="OpenAPI 3.1"></a>
  <img src="https://img.shields.io/badge/license-BSL--1.1%20%2F%20AGPL--3.0%20after%202029--01--01-blue" alt="Business Source License">
  <img src="https://img.shields.io/badge/status-public%20beta-blue" alt="Public Beta">
</p>

---

## Why AgentPay Exists

Autonomous agents are executing real work — booking, researching, transacting, building. As multi-agent workflows become the norm, agents need to pay each other, delegate tasks, and hold each other accountable.

Existing payment infrastructure was not designed for this. Stripe, Solana, and bank rails handle value transfer. None of them answer the questions that actually block agent commerce:

- **Is this agent who it claims to be?**
- **Has it delivered reliably in the past?**
- **Will it deliver this time — and what happens if it doesn't?**
- **Which payment rail makes sense for this transaction, and at what cost?**

Without a trust layer, high-value agent-to-agent transactions cannot happen at scale. Without a coordination layer, multi-protocol routing is bespoke logic rebuilt in every application. Without a dispute layer, bad outcomes have no enforceable resolution.

AgentPay is the threshold where agents become commercially legible. It does not replace payment rails — it makes them usable in autonomous contexts.

---

## What AgentPay Is

AgentPay is a hybrid infrastructure layer combining:

| Layer | Function |
|-------|----------|
| **Identity** | Know Your Agent (KYA) — verified registration, credential anchoring, delegation chains |
| **Reputation** | AgentRank — 0–1000 composite trust score derived from payment reliability, delivery history, behavioral signals, and sybil resistance |
| **Coordination** | Intent routing across Solana, Stripe, and hybrid payment rails — with fee transparency and protocol selection |
| **Escrow** | Structured A2A escrow with lock/approve/dispute flows, persisted to PostgreSQL |
| **Dispute** | Judicial layer for agent commerce — evidence collection, trust consequences, outcome recording |
| **Constitutional Agents** | Four foundation agents (IdentityVerifier, ReputationOracle, DisputeResolver, IntentCoordinator) operate the trust infrastructure |

Every transaction, delivery, and dispute outcome updates the trust graph. The trust graph is the moat — a behavioral record of the agent economy that compounds in accuracy and value as participation grows.

---

## Architecture

AgentPay runs on Cloudflare's global edge network with Supabase as the persistent store and Vercel for the operator dashboard.

```
Vercel Dashboard (Next.js)
         │
         │  HTTPS / API Key Auth
         ▼
Cloudflare Workers API  ←── primary public surface
  (Hono framework)
         │
         │  Cloudflare Hyperdrive (connection pooling)
         ▼
Supabase PostgreSQL  ←── durable store for all state
```

**Payment rails** connect at the Workers layer:
- **Solana** — USDC payment intents and on-chain verification
- **Stripe** — fiat/card payments and Stripe webhook processing

**Background jobs** run as Cloudflare Cron Triggers (every 5 and 15 minutes via `wrangler.toml`).

**Transitional note:** A Node.js/Express backend (`src/`) and a Render.com deployment (`render.yaml`) remain in the repository as a legacy fallback. The Cloudflare Workers API (`apps/api-edge/`) is the primary production surface. The legacy backend is being decommissioned incrementally; see `apps/api-edge/RENDER_RETIREMENT.md` for status.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture reference.

---

## The Constitutional Layer

AgentPay's trust infrastructure is operated by four constitutional agents:

| Agent | Layer | Role |
|-------|-------|------|
| **IdentityVerifierAgent** | #1 Identity | KYA — agent registration, credential signing, proof verification |
| **ReputationOracleAgent** | #2 Reputation | Trust score queries, counterparty risk, reputation history |
| **DisputeResolverAgent** | #3 Dispute | Evidence review, arbitration, reputation consequences |
| **IntentCoordinatorAgent** | #4 Coordination | Payment route selection across Solana, Stripe, and hybrid rails |

These agents expose their own API surface at `/api/foundation-agents/*` and participate in the public agent registry. Every interaction feeds the trust graph.

---

## The Trust Graph

The trust graph is AgentPay's core asset. Every event updates it:

- Successful delivery → trust score increases
- Payment failure → trust score decreases
- Dispute filed → flagged for review
- Dispute resolved → outcome permanently recorded
- Identity verified → stake anchored to the graph
- Oracle queried → reputation data accessed

This becomes the credit history of agents — impossible to replicate once established, and increasingly valuable as the network grows.

AgentRank is the public face of the trust graph: a 0–1000 composite score with letter grades (AAA through F), derived from five weighted factors: payment reliability (40%), service delivery (30%), transaction volume (15%), wallet age (10%), and inverse dispute rate (5%).

---

## Revenue Model

AgentPay's commercial model compounds across five layers, each reflecting a distinct structural role in agent commerce.

**1. Identity Verification Fees**
KYA is the entry gate into trusted participation. Every agent that wants to be taken seriously as a counterparty needs a verified identity. Verification is priced per event.

**2. Reputation Oracle Queries**
The trust graph is a proprietary data asset. Third-party applications — marketplaces, hiring platforms, risk systems — pay per query to access agent trust scores and counterparty risk signals.

**3. Intent Coordination Fees**
Every transaction routed through the coordination layer carries a fee. AgentPay selects the optimal path across Solana, Stripe, and hybrid flows — and charges for that intelligence.

**4. Dispute Arbitration and Trust Enforcement**
When outcomes are contested, the dispute layer provides a structured resolution flow. Arbitration fees scale with transaction size. Trust consequences — score adjustments, suspensions, permanent record — create real stakes.

**5. Enterprise API and Trust Graph Licensing**
Institutions and platform operators that need high-throughput API access, embedded trust graph infrastructure, or custom integrations access these capabilities through enterprise licensing.

These layers are not parallel revenue streams competing for the same customer. They are sequential: identity enables reputation, reputation enables coordination, coordination enables enforcement, and enforcement enables enterprise trust. Each layer strengthens the others.

---

## Public Beta Scope

The following capabilities are live in public beta:

| Capability | Status |
|------------|--------|
| Merchant registration + API key issuance | ✅ Live |
| API key authentication | ✅ Live |
| Payment intent creation | ✅ Live |
| Payment verification | ✅ Live |
| Receipt endpoint | ✅ Live |
| Certificate validation | ✅ Live |
| Webhook delivery | ✅ Live |
| Stripe webhook support | ✅ Live |
| Cloudflare Workers deployment | ✅ Live |
| Hyperdrive DB connectivity | ✅ Live |

Known limitations in the current beta:

| Area | Status |
|------|--------|
| Some legacy endpoints | Return 501 (stub) — not yet migrated to Workers |
| AgentRank computation | Partially implemented — score logic exists; Workers integration in progress |
| Escrow analytics | Incomplete |
| Solana listener | Runs on legacy Render backend pending CF Cron/Durable Object migration |
| Dispute resolution UI | Foundation agents are implemented; production notification flows are stubs |

Do not rely on stub endpoints or incomplete features for production use cases. See [docs/ENTERPRISE_READINESS.md](docs/ENTERPRISE_READINESS.md) for a full honest assessment.

---

## Getting Started

### Hosted — no setup required

1. Visit [agentpay.gg/build](https://agentpay.gg/build) and register your operator account.
2. Get your API key. Store it — it is shown once.
3. Use the API or SDK to start transacting.

```bash
export AGENTPAY_API_KEY="sk_live_..."

# Register an operator account
curl -X POST https://api.agentpay.gg/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{"name":"My Platform","email":"me@example.com","walletAddress":"<solana-address>"}'
# → {"apiKey":"sk_live_..."}

# Create a payment intent
curl -X POST https://api.agentpay.gg/api/v1/payment-intents \
  -H "Authorization: Bearer $AGENTPAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount":500,"currency":"USDC","metadata":{"order_id":"ord_abc"}}'
```

---

## Local Development

### Prerequisites

- **Node.js ≥ 20**
- **PostgreSQL ≥ 12** (local or Docker)
- **Wrangler CLI** — `npm install -g wrangler` (for Workers dev)

### Setup

```bash
git clone https://github.com/Rumblingb/Agentpay
cd Agentpay
npm ci
```

### Legacy backend (Node.js / Express)

Suitable for local development and exploration of the full feature surface.

```bash
cp .env.production.example .env   # fill in your values
node scripts/migrate.js           # apply DB migrations
npm run dev                       # API on :3001, dashboard on :3000
```

Verify:
```bash
curl http://localhost:3001/health
# {"status":"ok","version":"1.0.0"}
```

### Cloudflare Workers API (primary)

```bash
cd apps/api-edge
cp .dev.vars.example .dev.vars    # fill in secrets for local Workers dev
npm install
npx wrangler dev                  # Workers dev server on :8787
```

Verify:
```bash
curl http://localhost:8787/health
```

### Docker (fastest for full stack)

```bash
docker-compose up
```

---

## Deployment

| Surface | Platform | Config |
|---------|----------|--------|
| API (primary) | Cloudflare Workers | `apps/api-edge/wrangler.toml` |
| Dashboard | Vercel | `dashboard/vercel.json` |
| API (legacy/fallback) | Render | `render.yaml` |

### Deploy the Workers API

```bash
cd apps/api-edge
npx wrangler deploy
```

Secrets are set via `wrangler secret put`:
```bash
wrangler secret put DATABASE_URL
wrangler secret put WEBHOOK_SECRET
wrangler secret put AGENTPAY_SIGNING_SECRET
wrangler secret put VERIFICATION_SECRET
```

Non-secret vars are in `wrangler.toml` `[vars]`.

### Deploy the Dashboard

Import the repository into Vercel, set root directory to `dashboard`, and set `AGENTPAY_API_BASE_URL` to your Workers deployment URL.

See [DEPLOYMENT.md](DEPLOYMENT.md) for full instructions.

---

## Environment Overview

AgentPay has two separate configuration surfaces:

**Cloudflare Workers API** (`apps/api-edge/`):
- Secrets via `wrangler secret put` (never committed)
- Non-secret vars in `wrangler.toml [vars]`
- Local dev secrets in `apps/api-edge/.dev.vars`

**Legacy Node.js backend** (`src/`):
- All configuration via `.env` file
- See `.env.production.example` for the full annotated list

**Dashboard** (Vercel):
- `AGENTPAY_API_BASE_URL` — Workers URL or Render URL depending on cutover state

See [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) for the complete environment reference.

---

## SDK

```bash
# TypeScript/JavaScript
npm install @agentpay/sdk

# Python
pip install agentpay
```

```typescript
import { AgentPay } from '@agentpay/sdk';

const client = new AgentPay({ apiKey: process.env.AGENTPAY_API_KEY });

const rank = await client.agentRank.get('agent-id');
console.log(rank.score, rank.grade); // 750, 'A'
```

---

## Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/merchants/register` | Register operator account + get API key |
| `POST` | `/api/v1/payment-intents` | Create payment intent |
| `POST` | `/api/v1/payment-intents/:id/verify` | Verify payment |
| `GET` | `/api/receipts/:id` | Get payment receipt |
| `GET` | `/api/certificates/:id` | Certificate validation |
| `POST` | `/api/webhooks/register` | Register webhook endpoint |
| `GET` | `/api/foundation-agents` | Constitutional agent manifest |
| `POST` | `/api/foundation-agents/identity` | IdentityVerifierAgent |
| `POST` | `/api/foundation-agents/reputation` | ReputationOracleAgent |
| `POST` | `/api/foundation-agents/dispute` | DisputeResolverAgent |
| `POST` | `/api/foundation-agents/intent` | IntentCoordinatorAgent |
| `GET` | `/health` | Health check |

Full API reference: [openapi.yaml](openapi.yaml)

---

## Repository Map

```
Agentpay/
├── apps/
│   └── api-edge/           Primary Cloudflare Workers API (Hono)
│       ├── src/             Routes, middleware, DB lib, cron handlers
│       └── wrangler.toml    Workers config (vars, cron triggers, Hyperdrive binding)
│
├── dashboard/               Next.js operator dashboard (Vercel)
│
├── src/                     Legacy Node.js/Express backend (transitional/fallback)
│   ├── routes/              Express route handlers
│   ├── services/            Business logic (AgentRank, escrow, webhooks, etc.)
│   ├── agents/              Four constitutional agent implementations
│   └── protocols/           x402, ACP, AP2, Solana Pay adapters
│
├── sdk/                     TypeScript SDK (@agentpay/sdk)
├── cli/agentpay/            CLI tool for agent deployment and management
├── examples/                Integration examples (CrewAI, LangGraph, OpenAI Agents)
│
├── prisma/                  Prisma schema (legacy backend)
├── scripts/                 DB migrations, seeding, secret generation
├── tests/                   Full test suite (unit, integration, security, e2e)
│
├── docs/                    Architecture, security, product, operational docs
├── legal/                   Terms of service, privacy policy, disclaimers
│
├── openapi.yaml             Full OpenAPI 3.1 specification
├── render.yaml              Legacy Render.com deployment config
└── docker-compose.yml       Local development stack
```

---

## Security

- PBKDF2-SHA256 API keys with per-key salt
- HMAC-SHA256 signed webhooks
- Rate limiting on all endpoints
- Security headers on every response
- Audit logging to `payment_audit_log`
- Startup validation rejects insecure secrets in production

Do not commit secrets. See [SECURITY.md](SECURITY.md) for the full security policy and responsible disclosure instructions.

---

## Documentation

| Document | Description |
|----------|-------------|
| [QUICKSTART.md](QUICKSTART.md) | Fastest path to first API call |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deploy to Cloudflare Workers, Vercel, or self-host |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Environment variable reference for all surfaces |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture and domain boundaries |
| [docs/API_DESIGN.md](docs/API_DESIGN.md) | API standards, versioning, error codes |
| [SECURITY.md](SECURITY.md) | Security controls and responsible disclosure |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) | STRIDE threat model and attack trees |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Database schema and invariants |
| [docs/PRODUCT_THESIS.md](docs/PRODUCT_THESIS.md) | Product strategy and moat analysis |
| [docs/ENTERPRISE_READINESS.md](docs/ENTERPRISE_READINESS.md) | Honest enterprise capability assessment |
| [FOUNDATION_AGENTS_DEPLOYMENT.md](FOUNDATION_AGENTS_DEPLOYMENT.md) | Constitutional agent setup |
| [openapi.yaml](openapi.yaml) | Full OpenAPI 3.1 spec |

---

## License

AgentPay source code is released under the [Business Source License 1.1 (BSL)](LICENSE-BSL), which restricts use for competing commercial services. The code is publicly visible, but running a competing hosted service is prohibited under the BSL.

On 2029-01-01, the license automatically converts to [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html), allowing broader use under a strong copyleft license.

**Summary:**
- Source code is public
- Competing commercial services are restricted under BSL
- License converts to AGPL-3.0 after 2029-01-01

See LICENSE-BSL for full terms.

## Contact

- **Issues:** [GitHub Issues](https://github.com/Rumblingb/Agentpay/issues)
- **Security:** security@agentpay.gg
- [Terms of Service](legal/terms-of-service.md) · [Privacy Policy](legal/privacy-policy.md)
