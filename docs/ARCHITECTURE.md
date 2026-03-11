# Architecture — AgentPay

> **Version:** 2.0  
> **Last Updated:** 2026-03-11  
> **Owner:** Engineering

---

## Overview

AgentPay is the identity, trust, and coordination layer for autonomous agent commerce. It combines:

- **Agent identity** — Know Your Agent (KYA) registration and credential anchoring
- **Trust scoring** — AgentRank (0–1000 composite score with behavioral signals)
- **A2A escrow** — agent-to-agent payment escrow with dispute resolution
- **Multi-protocol payments** — Solana, Stripe, x402, ACP, AP2
- **Constitutional agents** — four foundation agents that operate the trust infrastructure
- **Webhook delivery** — real-time event notifications with HMAC signing

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Clients                                    │
│          AI Agents  │  Operator Dashboard  │  SDKs  │  CLI          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                        HTTPS / API Key Auth
                                  │
          ┌───────────────────────▼───────────────────────┐
          │         Vercel Dashboard (Next.js)             │
          │         agentpay.gg / apay-delta.vercel.app    │
          └───────────────────────┬───────────────────────┘
                                  │  AGENTPAY_API_BASE_URL
                                  │
          ┌───────────────────────▼───────────────────────┐
          │      Cloudflare Workers API  ← PRIMARY        │
          │      (Hono framework, apps/api-edge/)          │
          │                                               │
          │  merchants  │  intents  │  certificates       │
          │  webhooks   │  verify   │  receipt            │
          │  stripe webhooks  │  foundation-agents        │
          │                                               │
          │  Cron Triggers: */5 and */15 minute jobs      │
          └───────────────┬───────────────────────────────┘
                          │
                          │  Cloudflare Hyperdrive (connection pooling)
                          │
          ┌───────────────▼───────────────────────────────┐
          │           Supabase PostgreSQL                  │
          │   (primary durable store for all state)        │
          └───────────────────────────────────────────────┘

  ┌───────────────────────────────────────────────────────┐
  │  Payment Rails (connected at the Workers layer)        │
  │                                                       │
  │  Solana RPC ← USDC payment intents, on-chain verify   │
  │  Stripe API ← fiat/card payments, webhook processing   │
  └───────────────────────────────────────────────────────┘
```

---

## Runtime Surfaces

### Cloudflare Workers API (primary)

**Location:** `apps/api-edge/`  
**Framework:** Hono  
**Config:** `apps/api-edge/wrangler.toml`

The primary public API surface. Handles all inbound HTTP traffic from the dashboard and external integrations. Stateless per-request execution model.

- Secrets via `wrangler secret put` (stored in Cloudflare's encrypted secret store)
- Non-secret configuration in `wrangler.toml [vars]`
- Cloudflare Hyperdrive binding provides connection pooling to Supabase
- Two cron triggers: `*/5 * * * *` and `*/15 * * * *` for background jobs

**Live capabilities:** merchant registration, API key auth, payment intent creation, payment verification, receipt, certificate validation, webhook delivery, Stripe webhooks.

### Vercel Dashboard

**Location:** `dashboard/`  
**Framework:** Next.js  
**Config:** `dashboard/vercel.json`

The operator dashboard. Reads `AGENTPAY_API_BASE_URL` for all API calls and proxies them to the Workers deployment. Deployed independently from the API.

### Supabase PostgreSQL

All durable state — merchants, agents, payment intents, escrow, trust scores, webhook events, audit logs — is stored in Supabase PostgreSQL. The Cloudflare Hyperdrive binding (`HYPERDRIVE`) provides connection pooling and caching at the Workers edge.

**Important:** Hyperdrive requires the **direct Supabase connection string** (port 5432, not the pooled/PgBouncer URL on port 6543). Using the pooled URL creates double-pooling.

### Legacy Node.js/Express Backend (transitional)

**Location:** `src/`  
**Config:** `render.yaml`, `.env`

The original Express-based backend. Still present as a fallback during the Cloudflare Workers migration. It contains the full feature surface including AgentRank computation, A2A escrow, marketplace discovery, and the constitutional agents.

**Status:** Being decommissioned incrementally. Several capabilities not yet migrated to Workers continue to operate from this surface:
- Solana transaction listener (`src/services/solana-listener.ts`) — uses `setInterval`, incompatible with Workers
- Reconciliation daemon and liquidity cron
- Full AgentRank score computation
- PIN-based agent auth (uses `bcrypt`, a native module)

See `apps/api-edge/RENDER_RETIREMENT.md` for the full decommission checklist.

---

## Domain Boundaries

### Core Domains

| Domain | Responsibility | Key Services | Key Tables |
|--------|---------------|--------------|------------|
| **Identity** | Merchant and agent registration, API key management, KYA | `merchants.ts`, `agentIdentityService.ts` | `merchants`, `agents`, `agent_identities` |
| **Trust** | AgentRank score computation and history | `agentrankService.ts`, `reputationService.ts`, `riskEngine.ts` | `agentrank_scores`, `agent_reputation_network` |
| **Payments** | Payment intent lifecycle, multi-protocol routing | `intentService.ts`, `protocolRouter.ts` | `payment_intents`, `transactions` |
| **Escrow** | A2A escrow lock/approve/dispute/settle | `escrowService.ts`, `trust-escrow.ts` | `escrow_transactions`, `dispute_cases` |
| **Constitutional Agents** | Trust infrastructure services (identity, reputation, dispute, coordination) | `src/agents/` | `verification_credentials`, `disputes`, `reputation_query_logs`, `coordinated_transactions` |
| **Webhooks** | Event delivery and retry | `webhookEmitter.ts`, `webhookDeliveryWorker.ts` | `webhook_events` |
| **Audit** | Immutable event log | `audit.ts` | `payment_audit_log` |

---

## Constitutional Agents

Four foundation agents operate the trust infrastructure. They are implemented in `src/agents/` and exposed at `/api/foundation-agents/*`.

| Agent | Endpoint | Role |
|-------|----------|------|
| IdentityVerifierAgent | `POST /api/foundation-agents/identity` | KYA — credential signing and verification |
| ReputationOracleAgent | `POST /api/foundation-agents/reputation` | Trust score queries, counterparty risk |
| DisputeResolverAgent | `POST /api/foundation-agents/dispute` | Evidence review, arbitration, consequences |
| IntentCoordinatorAgent | `POST /api/foundation-agents/intent` | Payment route selection and orchestration |

---

## Data Flow: Payment Intent

```
Client                  Workers API              Supabase
  │                         │                       │
  │─ POST /api/v1/payment-intents ──────────────>  │
  │   {amount, currency, metadata}                  │
  │                    Auth check                   │
  │                    Validate env                 │
  │                         │── INSERT payment_intent ──>│
  │                         │<─ intent_id ──────────────│
  │<── {intentId, ...} ─────│                       │
  │                         │                       │
  │─ POST /verify/:txHash ──────────────────────>  │
  │                         │── UPDATE payment_intent ──>│
  │<── {verified: true} ────│                       │
```

## Data Flow: Constitutional Agent Query

```
Client                  Workers API           Foundation Agent        Supabase
  │                         │                       │                    │
  │─ POST /api/foundation-agents/reputation ──────>│                    │
  │   {agentId, requestingAgentId}                  │                    │
  │                         │── ReputationOracleAgent.query() ────────>  │
  │                         │                       │── SELECT agentrank │
  │                         │                       │<─ score, history   │
  │                         │                       │── INSERT query_log │
  │<── {trustScore, ...} ───│<─── result ───────────│                    │
```

---

## Background Jobs (Cron Triggers)

| Trigger | Interval | Responsibility |
|---------|----------|----------------|
| Cron #1 | `*/5 * * * *` | Webhook retry delivery, time-sensitive jobs |
| Cron #2 | `*/15 * * * *` | Reconciliation, score updates, maintenance |

Cron handlers are in `apps/api-edge/src/cron/`.

---

## Protocol Adapters

| Protocol | Surface | Notes |
|----------|---------|-------|
| x402 | Middleware (legacy backend) | HTTP 402 paywall standard |
| ACP | `/api/acp/*` (legacy backend) | Agent Communication Protocol |
| AP2 | `/api/ap2/*` (legacy backend) | Agent Payment Protocol v2 |
| Solana Pay | `/api/v1/payment-intents` (Workers + legacy) | Native USDC on Solana |
| Stripe | `/webhooks/stripe` (Workers) | Fiat card / bank payments + webhooks |

---

## Authentication

```
API Key Flow:
  Client sends: Authorization: Bearer sk_live_xxxxx
  Workers middleware:
    1. Extract key prefix (first 8 chars)
    2. Lookup merchant by key_prefix (fast index)
    3. Verify full key against stored hash+salt
    4. Attach merchant context to request

Admin endpoints (legacy backend):
  X-Admin-Secret: <ADMIN_SECRET_KEY>
  Rate limited separately
```

---

## Known Architectural Gaps

| Gap | Status | Plan |
|-----|--------|------|
| In-memory escrow (`trust-escrow.ts`) | Data lost on restart | Migrate to full DB persistence |
| Dual DB access patterns (raw `pg` + Prisma) | Tech debt | Consolidate on Prisma |
| Custom migration runner (`scripts/migrate.js`) | No migration history | Migrate to Prisma Migrate |
| AP2 in-memory cache | Pending intents lost on restart | Persist to DB |
| Solana listener incompatible with Workers | Runs on Render | Migrate to CF Durable Object or Cron |

See [docs/DECISIONS/](./DECISIONS/) for Architecture Decision Records.
