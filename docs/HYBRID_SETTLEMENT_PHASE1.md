# Hybrid Settlement Architecture — Phase 1 Analysis

> **Version:** 1.0  
> **Date:** 2026-03-11  
> **Purpose:** Protocol-native settlement identities and a common resolution engine  
> **Scope:** Repo-specific architecture map, files requiring change, naming gaps, implementation order  
> **Status:** Phase 1 complete — analysis only, no code changes

---

## 1. Current Integration Points

### 1.1 Payment Intent Creation

| Surface | File | Key Logic |
|---------|------|-----------|
| Core service | `src/services/intentService.ts` | `createIntent()` — inserts into `payment_intents`, generates `APV_<ts>_<hex>` token, builds Solana Pay URI |
| Merchant-auth route (Express) | `src/routes/intents.ts` | `POST /api/intents` — delegates to `intentController.createIntent()` |
| Agent-facing route (Express) | `src/routes/v1Intents.ts` | `POST /api/v1/payment-intents` — PIN-optional, embeds `agentId` in metadata |
| Fiat path (Express) | `src/routes/intents.ts` (`POST /fiat`) | Creates Stripe Checkout session + raw SQL `transactions` insert |
| Workers/Hono (primary) | `apps/api-edge/src/routes/intents.ts` | Full port of Express intent routes; raw SQL via `postgres.js` |
| Workers agent-facing | `apps/api-edge/src/routes/v1Intents.ts` | Mirrors Express `v1Intents.ts` |
| Controller | `src/controllers/intentController.ts` | Validates schema, calls `assertAgentOwnership`, delegates to `intentService` |

**What the current model generates per intent:**
- `id` (UUID, primary key in `payment_intents`)
- `verificationToken` = `APV_<timestamp>_<random>` — used as Solana Pay memo
- `protocol` field exists but is a free-text string, not enforced at creation
- No unified `settlementIdentityId` — identity is just the `id`
- No protocol-specific external reference stored at creation time

---

### 1.2 Verify Route

| Surface | File | Behavior |
|---------|------|----------|
| Express | `src/routes/verify.ts` | `GET /api/verify/:txHash` — looks up `transactions.transaction_hash`; returns HMAC-signed `{verified, intentId, agentId, merchantId, settlementTimestamp}` |
| Workers/Hono (primary) | `apps/api-edge/src/routes/verify.ts` | Identical logic; uses SubtleCrypto for HMAC; same response shape |

**Current coupling:**
- Route parameter is `txHash` — Solana-native concept
- Lookup is `WHERE transaction_hash = $1` in `transactions` table only
- No Stripe payment reference lookup path
- No AP2, x402, or ACP lookup path
- `TX_HASH_PATTERN = /^[a-zA-Z0-9]{16,128}$/` accepts any alphanumeric but the lookup is on a Solana-specific column

---

### 1.3 Receipt Route

| Surface | File | Behavior |
|---------|------|----------|
| Express | `src/routes/receipt.ts` | `GET /api/receipt/:intentId` — reads `payment_intents` via Prisma; returns intent + agent data; `escrow: null` (explicitly deferred) |
| Workers/Hono (primary) | `apps/api-edge/src/routes/receipt.ts` | Mirrors Express; raw SQL |

**Gap:** Receipt does not join to the `transactions` table for confirmed settlement proof (e.g. `transaction_hash`, `confirmation_depth`, `stripe_payment_reference`). Settlement evidence lives in `transactions` but receipt does not surface it.

---

### 1.4 Solana Ingest / Listener / Reconciliation

| Component | File | Notes |
|-----------|------|-------|
| On-chain verifier | `src/security/payment-verification.ts` | `verifyPaymentRecipient(txHash, recipient)` — calls Solana RPC, checks SPL-token `transfer` instruction; circuit breaker included |
| Blockchain listener | `src/services/solana-listener.ts` | Polls every 30 s; two query paths; fires webhook on confirm |
| Reconciliation daemon | `src/services/reconciliationDaemon.ts` | Runs every 15 min; detects DB vs on-chain drift |
| Migration to Workers | `apps/api-edge/SOLANA_LISTENER_MIGRATION.md` | Open ticket — `setInterval` incompatible with Workers; Durable Object or Cron planned |

**Listener query path 1 — `transactions` table:**
```sql
SELECT t.id, t.merchant_id, t.payment_id, t.amount_usdc,
       t.recipient_address, t.transaction_hash, m.webhook_url
FROM transactions t JOIN merchants m ON t.merchant_id = m.id
WHERE t.status = 'pending'
  AND t.transaction_hash IS NOT NULL
  AND t.expires_at > NOW()
```

**Listener query path 2 — `payment_intents` metadata:**
```sql
SELECT pi.id, pi.merchant_id, pi.amount, m.wallet_address,
       pi.metadata->>'tx_hash' AS txHash,
       pi.metadata, m.webhook_url
FROM payment_intents pi JOIN merchants m ON pi.merchant_id = m.id
WHERE pi.status = 'pending'
  AND pi.metadata->>'tx_hash' IS NOT NULL
  AND pi.expires_at > NOW()
```

`tx_hash` is embedded in `payment_intents.metadata` when an agent calls `POST /api/v1/payment-intents/:intentId/verify`. This is a side-channel, not a first-class column.

---

### 1.5 Stripe Webhook Handling

| File | Events Handled |
|------|---------------|
| `src/routes/stripeWebhooks.ts` (Express) | `checkout.session.completed`, `payment_intent.succeeded`, `account.updated` |
| `apps/api-edge/src/routes/stripeWebhooks.ts` (Workers/primary) | Same events |

**`checkout.session.completed` path:**
1. Looks up `transactions.stripe_payment_reference = sessionId`
2. Updates `transactions.status = 'confirmed'`
3. Inserts into `webhook_events` (Workers) or schedules via `webhooksService` (Express)

**`payment_intent.succeeded` path (Express only — `src/routes/stripeWebhooks.ts`):**
```sql
UPDATE intents SET status = 'confirmed'
WHERE stripe_payment_reference = $1 AND status != 'confirmed'
```
Table `intents` does not exist in the current schema; should be `transactions`. This is a latent bug in the Express backend only — the Workers version (`apps/api-edge/`) already correctly targets the `transactions` table.

**`account.updated` path (both Express and Workers):**
```sql
UPDATE merchants SET stripe_connected = true
WHERE stripe_account_id = $1
```
Columns `stripe_connected` and `stripe_account_id` do not exist in the Prisma schema. The actual column is `stripe_connected_account_id`. This silent no-op affects both backends and means Stripe Connect onboarding status is never persisted.

---

### 1.6 Prisma Schema and Migration Location

| Item | Location |
|------|----------|
| Prisma schema | `prisma/schema.prisma` |
| Initial DB creation | `scripts/create-db.js` |
| Post-initial migrations | `scripts/migrate.js` (31 migrations, `001`–`031`) |
| Prisma client | `src/lib/prisma.ts` |
| Workers DB client | `apps/api-edge/src/lib/db.ts` (raw `postgres.js`, no Prisma) |

Prisma is used **only** in the Express/Node.js backend (`src/`). The Workers/Hono backend (`apps/api-edge/`) uses raw SQL via `postgres.js` through the Cloudflare Hyperdrive binding.

---

### 1.7 Transaction and Payment Tables

| Table | Prisma Model | Key Columns | Settlement Path |
|-------|-------------|-------------|-----------------|
| `payment_intents` | `PaymentIntent` | `id`, `status`, `protocol`, `verification_token`, `metadata` | All protocols — lifecycle anchor |
| `transactions` | `transactions` | `transaction_hash`, `stripe_payment_reference`, `payer_address`, `recipient_address`, `status`, `confirmation_depth` | Solana + Stripe settled records |
| `escrow_transactions` | `escrow_transactions` | `escrow_account_pubkey`, `transaction_signature`, `status` | A2A escrow (Solana-native) |
| `agent_transactions` | `AgentTransaction` | `buyerAgentId`, `sellerAgentId`, `task`, `amount`, `escrowId` | Agent network hire/complete |
| `coordinated_transactions` | `CoordinatedTransaction` | `intentId`, `route`, `steps`, `externalTxId`, `status` | IntentCoordinatorAgent log |

---

### 1.8 Matching Logic Tied to Memo or Tx Hash

| Location | Mechanism | Protocol |
|----------|-----------|----------|
| `src/services/intentService.ts:63` | `verificationToken` used as Solana Pay `memo` field in URI | Solana Pay |
| `src/routes/v1Intents.ts:245` | `tx_hash` stored in `payment_intents.metadata` by agent | Solana |
| `src/services/solana-listener.ts:78` | `metadata->>'tx_hash'` polled per intent | Solana |
| `src/security/payment-verification.ts:115` | Recipient address matched in SPL-token instruction, **not** memo | Solana |
| `src/routes/stripeWebhooks.ts:39` | `stripe_payment_reference` matched on `checkout.session.completed` | Stripe |
| `src/routes/verify.ts:20` | `transaction_hash` lookup in `transactions` table | Solana |

**Key observation:** The `verificationToken` (memo) is included in the Solana Pay URI but is **not validated on-chain** by the current listener. The listener only checks that the right recipient received funds. The memo match is implicit (only one pending intent per merchant at a time in practice). This will break at scale or with multiple concurrent intents.

---

## 2. Files Requiring Changes

### 2.1 Schema and Migrations

| File | Change Needed |
|------|--------------|
| `prisma/schema.prisma` | Add `SettlementRecord` model or extend `transactions` with `protocol`, `externalRef`, `settlementIdentityId` columns |
| `scripts/migrate.js` | Add migration `032_settlement_identity` to add the new columns/table |

### 2.2 Core Resolution Path (Express — used by Node.js workers and Solana listener)

| File | Change Needed |
|------|--------------|
| `src/services/intentService.ts` | Attach `protocol` to the intent at creation; generate protocol-aware settlement identity |
| `src/services/solana-listener.ts` | Route confirmed transactions through a `SettlementResolver` interface instead of writing directly to `transactions` |
| `src/security/payment-verification.ts` | Extend to validate `memo` field against `verificationToken` (not just recipient address) |
| `src/routes/verify.ts` | Add protocol-aware lookup: accept `externalRef` for Stripe, `intentId` for AP2/x402 alongside `txHash` |
| `src/routes/v1Intents.ts` | Accept `protocol` field in verify body; pass to resolver |
| `src/routes/receipt.ts` | Join `transactions` to surface settlement proof on receipt |
| `src/routes/stripeWebhooks.ts` | Fix `UPDATE intents` → `UPDATE payment_intents`; fix `stripe_account_id` → `stripe_connected_account_id`; route through resolver |
| `src/controllers/intentController.ts` | Pass `protocol` through to `intentService` |

### 2.3 Workers/Hono API (Primary Production Surface)

| File | Change Needed |
|------|--------------|
| `apps/api-edge/src/routes/verify.ts` | Same protocol-aware lookup as Express version |
| `apps/api-edge/src/routes/v1Intents.ts` | Accept `protocol` in verify body |
| `apps/api-edge/src/routes/receipt.ts` | Join to `transactions` for settlement evidence |
| `apps/api-edge/src/routes/stripeWebhooks.ts` | Fix latent SQL bugs; route through resolver pattern |
| `apps/api-edge/src/routes/intents.ts` | Validate `protocol` against extended enum (add `stripe`) |

### 2.4 New Files to Create

| File | Purpose |
|------|---------|
| `src/services/settlementResolver.ts` | Common resolution engine: accepts `{protocol, externalRef, intentId}` and resolves to a canonical `SettlementRecord` |
| `src/types/settlement.ts` | Shared TypeScript types: `SettlementProtocol`, `SettlementRecord`, `ResolutionResult` |
| `apps/api-edge/src/lib/settlementResolver.ts` | Workers-compatible port of the resolver (no Node.js modules) |

---

## 3. Naming Differences: Desired Model vs Current Schema

| Desired Concept | Current Name(s) | Location | Notes |
|----------------|----------------|----------|-------|
| `settlementIdentityId` | `id` (of `payment_intents`) | `payment_intents.id` | Intent ID serves as settlement identity but is not explicitly named as such |
| `externalRef` | `transaction_hash` (Solana) + `stripe_payment_reference` (Stripe) | `transactions` table | Two separate columns, not a unified ref |
| `SettlementProtocol` | `protocol` (string, nullable) | `payment_intents.protocol` | Field exists; values: `solana`, `stripe`, `x402`, `ap2`, `acp`; not enforced as enum |
| `SettlementRecord` | `transactions` | DB table | Table name `transactions` is too generic; the model maps to settled payments |
| `ResolutionEngine` | `solana-listener.ts` + Stripe webhook handler | `src/services/` + `src/routes/` | Split across two separate files with no shared interface |
| `settlementTimestamp` | `created_at` (in `transactions`) | `transactions.created_at` | Already returned by verify endpoint under this name |
| `confirmationProof` | `confirmation_depth` | `transactions.confirmation_depth` | Solana-specific; no equivalent for Stripe |
| `payerIdentity` | `payer_address` | `transactions.payer_address` | Solana wallet; no analog for Stripe payer |
| `agentSettlementFlow` | Agent Network hire/complete | `agent_transactions` + `agent_escrow` | Separate model from merchant payment intents |
| `humanSettlementFlow` | Fiat Checkout | `POST /api/intents/fiat` → `stripe_payment_reference` | Implemented in Express, deferred in Workers (`501`) |
| `memoField` | `verificationToken` | `payment_intents.verification_token` | Used as Solana Pay memo but not validated on-chain |
| `settlementStatus` | `status` | Both `payment_intents.status` and `transactions.status` | Two status columns; `payment_intents`: `pending/completed/expired`; `transactions`: `pending/confirmed/released/expired` |

---

## 4. Recommended Implementation Order (This Repo Only)

### Phase 2 — Fix Latent Bugs (low-risk, high-value)

1. **`src/routes/stripeWebhooks.ts`** (Express only)  
   Fix `UPDATE intents` → `UPDATE transactions` in `payment_intent.succeeded` handler.  
   This table reference is a silent no-op; confirmed Stripe payments never flow to any settlement record.

2. **`src/routes/stripeWebhooks.ts` + `apps/api-edge/src/routes/stripeWebhooks.ts`** (both)  
   Fix `stripe_connected = true` and `stripe_account_id` → `stripe_connected_account_id` in `account.updated` handler.  
   Stripe Connect onboarding status is currently never written to the database.

3. **`src/security/payment-verification.ts`**  
   Add memo validation: verify that the Solana transaction's memo matches the `verificationToken` of the target intent. Without this, any payment to the right recipient confirms any pending intent.

### Phase 3 — Settlement Identity Type System

3. **`src/types/settlement.ts`** (new file)  
   Define `SettlementProtocol` union, `ExternalRef` type, `SettlementRecord` interface, `ResolutionResult` interface. These types will be the contract that all downstream phases implement.

4. **`prisma/schema.prisma` + `scripts/migrate.js` (migration `032`)**  
   Add to `transactions` table:
   - `protocol VARCHAR` — which settlement rail confirmed this
   - `external_ref TEXT` — unified external reference (replaces protocol-specific columns as the indexed lookup field; existing columns remain for backward compat)
   
   Backfill existing rows: `external_ref = COALESCE(transaction_hash, stripe_payment_reference)`.

### Phase 4 — Common Resolution Service

5. **`src/services/settlementResolver.ts`** (new file)  
   Interface: `resolve(protocol, externalRef, intentId) → ResolutionResult`  
   Implementations:
   - `SolanaResolver` — wraps `verifyPaymentRecipient()` + memo check
   - `StripeResolver` — wraps `stripeService.getIntentByStripeReference()`
   - `AP2Resolver` — reads `payment_intents` status (AP2 is internal, no on-chain verify)
   - `x402Resolver` — stub (policy enforcement, not settlement)

6. **`apps/api-edge/src/lib/settlementResolver.ts`** (new file)  
   Workers-compatible port. Uses `fetch()` instead of `@solana/web3.js`. Initially delegates to existing Workers cron/stub.

### Phase 5 — Route Migration

7. **`src/services/solana-listener.ts`**  
   Replace direct `UPDATE transactions` with `settlementResolver.resolve('solana', txHash, intentId)` call so confirmation logic is centralized.

8. **`src/routes/verify.ts` + `apps/api-edge/src/routes/verify.ts`**  
   Change route from `GET /api/verify/:txHash` to `GET /api/verify/:externalRef?protocol=solana` (backward-compatible — default protocol is `solana`, `txHash` pattern still accepted).  
   Add lookup by `transactions.external_ref` (new column) in addition to `transaction_hash`.

9. **`src/routes/v1Intents.ts` + `apps/api-edge/src/routes/v1Intents.ts`**  
   Add `protocol` field to `POST /:intentId/verify` body.  
   Route to `settlementResolver` instead of raw metadata write.

10. **`src/routes/receipt.ts` + `apps/api-edge/src/routes/receipt.ts`**  
    Join `transactions` on `payment_id = intent.id` to surface settlement evidence (`external_ref`, `protocol`, `confirmation_depth`, `settled_at`) in the receipt response.

### Phase 6 — Agent-to-Agent and Agent-to-Human Flows

11. **`src/routes/agents.ts`** (hire/complete endpoints)  
    Emit `TrustEvent` through the resolver on complete/dispute to close the loop between agent network transactions and the settlement identity.

12. **`apps/api-edge/src/routes/intents.ts`**  
    Enable `POST /api/intents/fiat` (currently returns `501`) by integrating Stripe SDK via the `StripeResolver`.

---

## 5. Repo-Specific Architecture Map

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Settlement Identity Layer (TARGET)                 │
│                                                                       │
│  PaymentIntent ──→ SettlementIdentityId (= intentId)                 │
│  ├── protocol: solana | stripe | x402 | ap2 | acp | agent            │
│  ├── externalRef: txHash | stripeSessionId | ap2Token | null          │
│  └── status: pending → completed / expired                           │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
             ┌─────────────────▼──────────────────┐
             │     Common Resolution Engine        │
             │   src/services/settlementResolver   │
             │                                     │
             │  SolanaResolver ─→ verifyPaymentRecipient()            │
             │  StripeResolver ─→ stripeService.getIntentByRef()      │
             │  AP2Resolver    ─→ payment_intents status check        │
             │  x402Resolver   ─→ policy gate (no settlement)        │
             └────────────────────────────────────┘
                               │
           ┌───────────────────┴────────────────────┐
           │                                         │
    ┌──────▼──────┐                       ┌──────────▼─────────┐
    │  Solana     │                       │  Stripe             │
    │  Listener   │                       │  Webhook Handler    │
    │  (Express)  │                       │  (Workers/Express)  │
    │  src/services│                      │  apps/api-edge/src  │
    │  /solana-   │                       │  /routes/           │
    │  listener.ts│                       │  stripeWebhooks.ts  │
    └──────┬──────┘                       └──────────┬──────────┘
           │                                         │
           └──────────────┬──────────────────────────┘
                          │ writes
                ┌─────────▼──────────┐
                │   transactions     │
                │   (Supabase/PG)    │
                │                   │
                │ transaction_hash   │ ← Solana
                │ stripe_payment_ref │ ← Stripe
                │ external_ref       │ ← unified (Phase 4)
                │ protocol           │ ← new (Phase 3)
                └────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                     API Surface Map                                   │
│                                                                       │
│  POST /api/intents          → intentService.createIntent()           │
│  POST /api/v1/payment-intents → v1Intents (agent-facing)            │
│  POST /api/v1/payment-intents/:id/verify → stores externalRef        │
│  GET  /api/verify/:externalRef → common verify (Phase 5)             │
│  GET  /api/receipt/:intentId   → intent + settlement evidence        │
│  POST /webhooks/stripe         → StripeResolver path                 │
│                                                                       │
│  PRIMARY: apps/api-edge/ (Cloudflare Workers + Hono)                 │
│  LEGACY:  src/ (Express/Render — Solana listener lives here)         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 6. Known Risks and Constraints

| Risk | Severity | Mitigation |
|------|----------|-----------|
| `setInterval`-based Solana listener cannot run in Workers | High | Move to Cloudflare Durable Object or Cron Trigger before decommissioning Express (see `apps/api-edge/SOLANA_LISTENER_MIGRATION.md`) |
| Memo not validated on-chain | High | Phase 2: add memo check to `verifyPaymentRecipient()` |
| Stripe webhook `payment_intent.succeeded` silent no-op (Express only) | High | Phase 2: fix `UPDATE intents` → `UPDATE transactions` in `src/routes/stripeWebhooks.ts` |
| `account.updated` columns wrong in both Express and Workers backends | High | Phase 2: fix `stripe_connected`/`stripe_account_id` → `stripe_connected_account_id` |
| `transactions.stripe_payment_reference` is not indexed | Medium | Add index in migration `032` |
| AP2 in-memory cache lost on restart | Medium | Already noted in `ARCHITECTURE.md`; persist to `payment_intents` (partial fix in place) |
| Dual DB access patterns (raw `pg` vs Prisma) | Low | Workers uses only raw SQL; Express migration to Prisma is incremental |
| Verify route only looks up by `transaction_hash` (Solana) | High | Phase 5: add `external_ref` lookup with `protocol` discriminator |

---

*Phase 1 ends here. Code changes begin in Phase 2.*
