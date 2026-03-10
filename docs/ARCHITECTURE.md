# Architecture — AgentPay

> **Version:** 1.0  
> **Last Updated:** 2026-03-10  
> **Owner:** Engineering

---

## Overview

AgentPay is a financial infrastructure platform for AI agents. It provides:

- **Agent registration and identity** (KYA — Know Your Agent)
- **Trust scoring** (AgentRank — 0–1000 score with behavioral signals)
- **A2A escrow** (agent-to-agent payment escrow with dispute resolution)
- **Multi-protocol payments** (x402, ACP, AP2, Solana Pay, Stripe)
- **Marketplace discovery** (semantic search and leaderboard for agent services)
- **Webhook delivery** (real-time event notifications)

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Clients                                     │
│         AI Agents  │  Dashboards  │  SDKs  │  CLI  │  Integrations │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                        HTTPS / API Key Auth
                                  │
┌─────────────────────────────────▼───────────────────────────────────┐
│                        AgentPay API                                   │
│                  (Node 20 / Express / TypeScript)                     │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │   Merchants   │  │    Agents    │  │       Protocols          │   │
│  │  (API keys,  │  │ (identity,   │  │ (x402, ACP, AP2,        │   │
│  │   billing)   │  │  KYA, RBAC) │  │  Solana Pay, Stripe)    │   │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘   │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │  AgentRank   │  │    Escrow    │  │       Webhooks           │   │
│  │ (trust score │  │ (lock/approve│  │  (delivery, retry,      │   │
│  │  0-1000)    │  │  /dispute)   │  │   signature)            │   │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘   │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Middleware Layer                           │    │
│  │  Auth  │  RBAC  │  Rate Limiting  │  Logging  │  Metrics    │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
               ┌───────────────────┼───────────────────┐
               │                   │                   │
    ┌──────────▼──────┐   ┌────────▼────────┐   ┌─────▼──────────┐
    │   PostgreSQL     │   │   Stripe API    │   │  Solana RPC    │
    │  (Render PG)     │   │  (Fiat/cards)   │   │  (Devnet now)  │
    └─────────────────┘   └─────────────────┘   └────────────────┘
```

---

## Domain Boundaries

### Core Domains

| Domain | Responsibility | Key Services | Key Tables |
|--------|---------------|--------------|------------|
| **Identity** | Merchant and agent registration, API key management | `merchants.ts`, `agentIdentityService.ts` | `merchants`, `agents`, `agent_identities` |
| **Trust** | AgentRank score computation and history | `agentrankService.ts`, `reputationService.ts`, `riskEngine.ts` | `agentrank_scores`, `agent_reputation_network` |
| **Payments** | Payment intent lifecycle, multi-protocol routing | `intentService.ts`, `protocolRouter.ts` | `payment_intents`, `transactions` |
| **Escrow** | A2A escrow lock/approve/dispute/settle | `escrowService.ts`, `trust-escrow.ts` | `escrow_transactions`, `dispute_cases` |
| **Marketplace** | Agent discovery, search, and leaderboard | `discoveryService.ts`, `ranking.ts` | `agents`, `agentrank_scores` |
| **Constitutional Agents** | Trust infrastructure services (identity, reputation, dispute, coordination) | `src/agents/` | `verification_credentials`, `disputes`, `reputation_query_logs`, `coordinated_transactions` |
| **Webhooks** | Event delivery and retry | `webhookEmitter.ts`, `webhookDeliveryWorker.ts` | `webhook_events` |
| **Audit** | Immutable event log | `audit.ts` | `payment_audit_log` |

### Supporting Domains

| Domain | Responsibility |
|--------|---------------|
| **KYA/KYC** | Know Your Agent identity verification |
| **Billing** | Fee calculation, revenue tracking |
| **Reconciliation** | Payment reconciliation and anomaly detection |
| **Delegation** | Sub-agent and delegation chains |
| **Insurance** | Behavioral oracle backstop pool |

---

## API Layer

All routes are under `/api`. Key route groups:

```
POST   /api/merchants/register         — Create merchant + API key
POST   /api/merchants/auth             — Verify API key (internal)
GET    /api/agents                     — List agents (paginated)
POST   /api/agents/register            — Register agent
GET    /api/agents/:id                 — Get agent details
POST   /api/agents/hire                — Hire agent (creates escrow)
POST   /api/agents/complete            — Complete job (releases escrow)
GET    /api/agentrank/:agentId         — Get trust score
POST   /api/agentrank/:agentId/adjust  — Adjust trust score (admin)
POST   /api/v1/payment-intents         — Create payment intent
POST   /api/v1/payment-intents/:id/verify — Verify payment
POST   /api/escrow/create              — Create escrow
POST   /api/escrow/approve             — Approve/release escrow
POST   /api/escrow/dispute             — Raise dispute
GET    /api/marketplace/discover       — Discover agents
GET    /api/marketplace/leaderboard    — Top agents by score
GET    /api/foundation-agents          — List constitutional agents (manifest)
POST   /api/foundation-agents/identity    — IdentityVerifierAgent
POST   /api/foundation-agents/reputation  — ReputationOracleAgent
POST   /api/foundation-agents/dispute     — DisputeResolverAgent
POST   /api/foundation-agents/intent      — IntentCoordinatorAgent
POST   /api/webhooks/register          — Register webhook endpoint
GET    /metrics                        — Prometheus metrics
GET    /health                         — Health check
```

---

## Data Flow: Core Wedge (Hire → Complete → Settle)

```
Agent A (hirer)          AgentPay API              Agent B (worker)
     │                        │                         │
     │── POST /agents/hire ──>│                         │
     │   {sellerAgentId,      │── Risk check ──>        │
     │    task, amount}       │── Create escrow ──>     │
     │<── {escrowId, ...} ───│   (escrow_transactions) │
     │                        │                         │
     │                        │── Notify B ─────────>  │
     │                        │   (webhook event)       │
     │                        │                         │
     │                        │<─ POST /agents/complete │
     │                        │   {escrowId, output}    │
     │                        │── Fee calc ──>          │
     │                        │── Release escrow ──>    │
     │                        │── AgentRank update ─>   │
     │<── settlement event ──│── Webhook to A ──────>  │
```

---

## Authentication and Authorization

```
API Key Flow:
  Client sends: Authorization: Bearer sk_live_xxxxx
                OR X-Api-Key: sk_live_xxxxx
  Middleware:
    1. Extract key prefix (first 8 chars)
    2. Lookup merchant by key_prefix (fast index lookup)
    3. PBKDF2-verify full key against stored hash+salt
    4. Attach merchant context to request
    5. resolveRoles() → attaches role array from DB

RBAC:
  Roles: admin, platform, merchant, agent, readonly
  Enforcement: requireRole(['admin', 'platform']) middleware
  Role assignment: stored in roles/user_roles tables (migration 026)

Admin endpoints:
  X-Admin-Secret: <ADMIN_SECRET_KEY env var>
  Rate limited separately
```

---

## Background Jobs

| Job | Trigger | Notes |
|-----|---------|-------|
| `reconciliationDaemon` | Server startup, periodic | Detects payment anomalies |
| `webhookDeliveryWorker` | Event emitted | Retries with backoff |
| `solana-listener` | Server startup | Polls Solana RPC for confirmation |
| `liquidityService` | Cron (if enabled) | Manages liquidity pool |

---

## Protocol Adapters

| Protocol | Endpoint Prefix | Notes |
|----------|----------------|-------|
| x402 | Middleware | HTTP 402 paywall standard |
| ACP | `/api/acp/*` | Agent Communication Protocol |
| AP2 | `/api/ap2/*` | Agent Payment Protocol v2 (cache: in-memory + Prisma) |
| Solana Pay | `/api/v1/payment-intents` | Native USDC on Solana |
| Stripe | `/api/fiat/*`, `/api/stripe/*` | Fiat card / bank payments |

---

## Known Architectural Gaps

1. **In-memory escrow** (`trust-escrow.ts`) — data lost on restart. All escrow must be persisted.
2. **Dual DB access patterns** — raw `pg` pool in `src/db/` and Prisma client in `src/lib/` coexist. Long-term, consolidate on Prisma.
3. **Custom migration runner** — `scripts/migrate.js` lacks proper migration history. Plan migration to Prisma Migrate.
4. **AP2 in-memory cache** — pending AP2 intents lost on restart.
5. **No multi-tenancy** — single organization model currently.

See [docs/DECISIONS/](./DECISIONS/) for Architecture Decision Records.
