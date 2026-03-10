# Data Model — AgentPay

> **Version:** 1.0  
> **Last Updated:** 2026-03-10  
> **Owner:** Engineering

---

## Overview

AgentPay uses PostgreSQL as its primary data store. The schema is defined in `prisma/schema.prisma` and bootstrapped via `scripts/create-db.js`. Post-initial migrations are managed by `scripts/migrate.js`.

---

## Entity Relationship Overview

```
Merchant ─────< Agent
   │              │
   │              ├─────< PaymentIntent
   │              ├─────< AgentTransaction (network hire/complete)
   │              ├─────< AgentEscrow (per-hire escrow record)
   │              ├─────< AgentReputation
   │              └─────< agent_identities (KYA)
   │
   └─────< transactions
   └─────< webhook_events
   └─────< payment_audit_log

AgentTransaction ──── AgentEscrow
escrow_transactions ──── dispute_cases
agent_wallets (custodial wallets for walletless agents)
agentrank_scores (trust score + history per agent)
```

---

## Table Reference

### `merchants`

Primary identity entity for platform operators and API key holders.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Auto-generated |
| `name` | VARCHAR | Display name |
| `email` | VARCHAR UNIQUE | Login email |
| `api_key_hash` | TEXT | PBKDF2-SHA256 hash |
| `api_key_salt` | TEXT | Per-key salt |
| `key_prefix` | VARCHAR(8) | First 8 chars of key for fast lookup |
| `wallet_address` | TEXT | Solana wallet address for settlement |
| `webhook_url` | TEXT nullable | Default webhook endpoint |
| `stripe_connected_account_id` | TEXT nullable | Stripe Connect account |
| `is_active` | BOOLEAN | Soft-delete flag |
| `total_volume` | NUMERIC(20,6) | Lifetime escrow volume |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Indexes:** `key_prefix` (fast API key lookup), `email` (unique)  
**Retention:** Indefinite (compliance requirement)  
**Owner:** Platform (merchant self-service + admin)

---

### `agents`

AI agent entities that can register, be hired, and earn reputation.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `merchant_id` | UUID FK → merchants | Owning merchant |
| `display_name` | VARCHAR | Human-readable name |
| `public_key` | TEXT nullable | Solana public key |
| `risk_score` | INT DEFAULT 500 | Raw risk score |
| `service` | TEXT nullable | Service category |
| `endpoint_url` | TEXT nullable | Agent service endpoint |
| `pricing_model` | JSON nullable | Pricing structure |
| `rating` | FLOAT DEFAULT 5.0 | Aggregate rating |
| `total_earnings` | FLOAT DEFAULT 0 | Lifetime earnings |
| `tasks_completed` | INT DEFAULT 0 | Completed job count |
| `embedding` | vector(1536) nullable | Semantic search vector (pgvector) |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Indexes:** `merchant_id`, `service` (marketplace discovery)  
**Retention:** Indefinite  
**Owner:** Merchant (via API), Platform (admin)  
**Invariants:** Agent must belong to a valid active merchant

---

### `payment_intents`

Represents a pending or completed payment request.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `merchant_id` | UUID FK → merchants | |
| `agent_id` | UUID FK → agents nullable | |
| `amount` | DECIMAL(20,6) | Payment amount |
| `currency` | VARCHAR DEFAULT 'USDC' | |
| `status` | VARCHAR | pending / completed / expired / failed |
| `protocol` | VARCHAR nullable | x402 / ACP / AP2 / solana / stripe |
| `verification_token` | VARCHAR UNIQUE | One-time verification token |
| `expires_at` | TIMESTAMPTZ | Intent expiry |
| `metadata` | JSON nullable | Protocol-specific data |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Indexes:** `merchant_id`, `verification_token` (unique), `agent_id`  
**Retention:** 7 years (financial records)  
**Invariants:** Amount must be positive; expiry must be in the future at creation

---

### `transactions`

Confirmed/settled payment records.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `merchant_id` | UUID | |
| `payment_id` | UUID UNIQUE | Links to payment_intents |
| `amount_usdc` | DECIMAL(20,6) | |
| `recipient_address` | VARCHAR | Solana address |
| `payer_address` | VARCHAR nullable | |
| `transaction_hash` | VARCHAR nullable | On-chain tx hash |
| `stripe_payment_reference` | VARCHAR nullable | |
| `status` | VARCHAR DEFAULT 'pending' | |
| `webhook_status` | VARCHAR DEFAULT 'not_sent' | |
| `confirmation_depth` | INT DEFAULT 0 | Solana confirmations |
| `required_depth` | INT DEFAULT 2 | Min confirmations |
| `expires_at` | TIMESTAMPTZ nullable | |
| `metadata` | JSON nullable | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Indexes:** `merchant_id`, `payment_id` (unique), `transaction_hash`, `webhook_status`  
**Retention:** 7 years  
**Invariants:** `amount_usdc` must be positive; `payment_id` must be unique

---

### `escrow_transactions`

Durable escrow records for A2A job contracts.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `hiring_agent` | VARCHAR | Agent ID of hirer |
| `working_agent` | VARCHAR | Agent ID of worker |
| `amount_usdc` | DECIMAL(20,6) | Escrowed amount |
| `status` | VARCHAR DEFAULT 'funded' | funded / approved / disputed / settled |
| `work_description` | TEXT nullable | Job description |
| `deadline` | TIMESTAMPTZ nullable | Job deadline |
| `completed_at` | TIMESTAMPTZ nullable | Completion timestamp |
| `reputation_delta_hiring` | INT DEFAULT 0 | Score change for hirer |
| `reputation_delta_working` | INT DEFAULT 0 | Score change for worker |
| `dispute_reason` | TEXT nullable | |
| `guilty_party` | VARCHAR nullable | who was at fault |
| `escrow_account_pubkey` | VARCHAR nullable | On-chain escrow account |
| `transaction_signature` | VARCHAR nullable | On-chain tx |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Status transitions:** `funded → approved`, `funded → disputed → settled`  
**Retention:** 7 years  
**Invariants:** amount must be positive; `working_agent ≠ hiring_agent`

---

### `dispute_cases`

Dispute resolution cases linked to escrow transactions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `escrow_id` | VARCHAR | Links to `escrow_transactions.id` |
| `hiring_agent` | VARCHAR | |
| `working_agent` | VARCHAR | |
| `amount_usdc` | DECIMAL(20,6) | |
| `evidence` | JSON | Submitted evidence |
| `completion_score` | DECIMAL(5,3) nullable | 0-1 work quality score |
| `peer_reviews` | JSON | External peer reviews |
| `outcome` | VARCHAR nullable | Resolution outcome |
| `worker_payout` | DECIMAL(20,6) | Amount paid to worker |
| `hirer_refund` | DECIMAL(20,6) | Amount refunded to hirer |
| `resolved` | BOOLEAN | |
| `resolved_at` | TIMESTAMPTZ nullable | |
| `created_at` | TIMESTAMPTZ | |

**Retention:** 7 years  
**Invariants:** `worker_payout + hirer_refund = amount_usdc`

---

### `agentrank_scores`

AgentRank trust score per agent.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `agent_id` | VARCHAR UNIQUE | |
| `score` | INT DEFAULT 0 | 0–1000 |
| `grade` | VARCHAR | U/D/C/B/A/AA/AAA |
| `payment_reliability` | DECIMAL(5,4) | 0–1 |
| `service_delivery` | DECIMAL(5,4) | 0–1 |
| `transaction_volume` | INT | |
| `wallet_age_days` | INT | |
| `dispute_rate` | DECIMAL(5,4) | 0–1 |
| `stake_usdc` | DECIMAL(20,6) | |
| `unique_counterparties` | INT | |
| `factors` | JSON | Weighted factor breakdown |
| `history` | JSON | Score change history |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Invariants:** `score` must be 0–1000; all rate columns must be 0–1

---

### `payment_audit_log`

Immutable audit trail for all payment operations.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `merchant_id` | UUID nullable | |
| `ip_address` | VARCHAR | |
| `transaction_signature` | VARCHAR nullable | |
| `endpoint` | VARCHAR | |
| `method` | VARCHAR | |
| `succeeded` | BOOLEAN | |
| `failure_reason` | TEXT nullable | |
| `created_at` | TIMESTAMPTZ | |

**Retention:** 7 years minimum  
**Invariants:** Append-only; no UPDATE or DELETE paths

---

### `agent_wallets`

Custodial Solana wallets for walletless agents (e.g., Moltbook bots).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `agent_id` | VARCHAR UNIQUE | |
| `public_key` | VARCHAR | Solana public key |
| `encrypted_private_key` | VARCHAR | AES-256-GCM encrypted |
| `balance_usdc` | DECIMAL(20,6) | |
| `label` | VARCHAR nullable | |
| `is_active` | BOOLEAN | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Key storage:** Private key encrypted via `walletEncryption.ts` using `AGENTPAY_SIGNING_SECRET`  
**Invariants:** `balance_usdc` must never go negative; `public_key` must be valid Solana address

---

## Known Data Model Gaps

1. **`agent_transactions` uses CUID not UUID** — inconsistent with the rest of the schema (UUIDs)
2. **No soft-delete on agents** — deactivated agents should have an `is_active` flag; currently no deactivation path
3. **`payment_intents.id` is not auto-generated** — caller must supply UUID
4. **No `wallet_events` table** — wallet balance changes are not audit-logged separately
5. **In-memory escrow** — `trust-escrow.ts` holds state that should be in `escrow_transactions`

---

## Indexing Strategy

Critical indexes for query performance:

| Table | Index | Purpose |
|-------|-------|---------|
| `merchants` | `key_prefix` | API key fast lookup |
| `merchants` | `email` (unique) | Registration check |
| `agents` | `merchant_id` | Agent listing per merchant |
| `payment_intents` | `verification_token` (unique) | Intent verification |
| `transactions` | `payment_id` (unique) | Payment dedup |
| `agentrank_scores` | `agent_id` (unique) | Score lookup |
| `payment_audit_log` | `merchant_id`, `created_at` | Audit queries |
