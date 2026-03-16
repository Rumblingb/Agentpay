# Foundation Agents — Deployment Guide

> **Status:** Accurate as of 2026-03-11. This guide covers deploying the four constitutional agents in your AgentPay instance.

The 4 constitutional agents are implemented in `src/agents/` and exposed via the legacy Node.js backend at `/api/foundation-agents/*`. They operate the core trust infrastructure — identity verification, reputation oracle queries, dispute resolution, and intent coordination.

**Note:** The foundation agents run on the legacy Node.js backend. The Cloudflare Workers migration for these routes is tracked in `apps/api-edge/RENDER_RETIREMENT.md`.

---

## The 4 Constitutional Agents

| Agent | Layer | Endpoint | Revenue |
|---|---|---|---|
| IdentityVerifier | #1 Identity | `POST /api/foundation-agents/identity` | $10–50/verification |
| TrustOracle | #2 Reputation | `POST /api/foundation-agents/reputation` | $1–5/query |
| SettlementGuardian | #3 Dispute / Escrow | `POST /api/foundation-agents/dispute` | $50–500/case |
| NetworkObserver | #4 Coordination / Monitoring | `POST /api/foundation-agents/intent` | $0.25–1.00/tx |

---

## Prerequisites

- Node.js ≥ 20, npm ≥ 9
- PostgreSQL database (see `.env.production.example`)
- `.env` file with at least `DATABASE_URL`

Optional:
- `IDENTITY_VERIFIER_PRIVATE_KEY` — 32+ byte hex string for credential signing.
  If not set, a random key is generated per process restart (credentials become
  unverifiable across restarts). Set this in production.

---

## Step 1 — Run migrations

The migration `030_foundation_agents` creates all tables required by these agents:

```bash
node scripts/migrate.js
```

Tables created: `verification_credentials`, `identity_links`, `reputation_query_logs`,
`disputes`, `coordinated_transactions`, `agent_fee_transactions`.

Also adds `operator_id` and `trust_score` columns to the `agents` table.

---

## Step 2 — Register agents in the database

This seeds the 4 foundation agents as rows in the `agents` table so they appear
in the public registry, the leaderboard, and the `/api/foundation-agents` manifest.

```bash
npm run seed:foundation-agents
# or: npx tsx scripts/seed-foundation-agents.ts
```

Safe to re-run (idempotent upsert). Set `API_BASE_URL` in your `.env` to the
deployed API base (e.g. `https://agentpay-api.onrender.com`) so the `endpointUrl`
field stored in the DB is correct.

---

## Step 3 — Start the server

```bash
# Development
npm run dev

# Production
npm run build && node dist/server.js
```

The foundation agents router is mounted at `/api/foundation-agents` in `src/server.ts`.

---

## Step 4 — Verify via CLI

```bash
# Install CLI dependencies (one-time)
cd cli/agentpay && npm install && cd ../..

# List all 4 constitutional agents
AGENTPAY_API_BASE=http://localhost:3000 node cli/agentpay/index.js foundation list

# Inspect a specific agent
AGENTPAY_API_BASE=http://localhost:3000 node cli/agentpay/index.js foundation inspect identity
AGENTPAY_API_BASE=http://localhost:3000 node cli/agentpay/index.js foundation inspect reputation
AGENTPAY_API_BASE=http://localhost:3000 node cli/agentpay/index.js foundation inspect dispute
AGENTPAY_API_BASE=http://localhost:3000 node cli/agentpay/index.js foundation inspect intent
```

---

## Step 5 — Verify via HTTP

```bash
# Discovery manifest
curl http://localhost:3000/api/foundation-agents

# Identity: get an agent's identity record
curl -X POST http://localhost:3000/api/foundation-agents/identity \
  -H 'Content-Type: application/json' \
  -d '{"action":"get_identity","agentId":"<agent-uuid>"}'

# Reputation: get trust score (cheap query)
curl -X POST http://localhost:3000/api/foundation-agents/reputation \
  -H 'Content-Type: application/json' \
  -d '{"action":"get_trust_score","agentId":"<agent-uuid>","requestingAgentId":"<your-agent-uuid>"}'

# Intent: get route recommendations without executing
curl -X POST http://localhost:3000/api/foundation-agents/intent \
  -H 'Content-Type: application/json' \
  -d '{"action":"recommend_route","fromAgent":"a","toAgent":"b","amount":100,"currency":"USD","purpose":"test"}'

# Dispute: look up an agent's dispute history
curl -X POST http://localhost:3000/api/foundation-agents/dispute \
  -H 'Content-Type: application/json' \
  -d '{"action":"get_history","agentId":"<agent-uuid>"}'
```

---

## File Map

```
src/agents/
  IdentityVerifierAgent.ts   ← Constitutional agent #1
  ReputationOracleAgent.ts   ← Constitutional agent #2
  DisputeResolverAgent.ts    ← Constitutional agent #3
  IntentCoordinatorAgent.ts  ← Constitutional agent #4
  index.ts                   ← Barrel export

src/routes/
  foundationAgents.ts        ← Express router mounted at /api/foundation-agents

scripts/
  migrate.js                 ← Migration 030_foundation_agents
  seed-foundation-agents.ts  ← Seeds the 4 agents into the agents table

cli/agentpay/
  index.js                   ← foundation list / foundation inspect commands

docs/
  FOUNDATION_AGENTS.md                ← Developer reference docs
  FOUNDATION_AGENTS_READINESS_PLAN.md ← Audit findings (Phase 1)
  FOUNDATION_AGENTS_SHIP_CHECKLIST.md ← Pre-ship checklist (Phase 7)
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `IDENTITY_VERIFIER_PRIVATE_KEY` | Recommended in prod | Hex secret for HS256 credential signing |
| `API_BASE_URL` | Recommended in prod | Used by seed script for endpoint URLs |

---

## What Is Not Yet Production-Complete

These areas are functional stubs — they work but need real implementation before
they can be used in production with actual value at stake:

- **`verifyDeploymentProof`** / **`verifySignatureProof`** in IdentityVerifierAgent:
  Always return `true`. Production would verify Vercel deployment URLs, OAuth tokens, etc.

- **`notifyRespondent`** / **`notifyResolution`** in DisputeResolverAgent:
  No-ops. Production would send email or webhook to the notified party.

- **`beginResolution`** in DisputeResolverAgent:
  No-op. Production would schedule a resolution job after the 48h evidence window.

- **Protocol execution** in IntentCoordinatorAgent (Stripe, Solana, x402, AP2, bank):
  Steps are created but actual API calls are commented with `// Production:` markers.

See `docs/FOUNDATION_AGENTS.md` for the full capability matrix.
