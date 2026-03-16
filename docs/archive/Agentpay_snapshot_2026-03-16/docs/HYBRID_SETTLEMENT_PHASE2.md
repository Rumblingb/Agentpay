# Hybrid Settlement Architecture — Phase 2: Schema Changes

> **Version:** 1.0  
> **Date:** 2026-03-11  
> **Depends on:** `docs/HYBRID_SETTLEMENT_PHASE1.md`  
> **Status:** Complete — schema and migration applied, no application code changed  
> **Commit message:** `feat(schema): add settlement identity layer (Phase 2)`

---

## Overview

Phase 2 adds four new tables and one new column to prepare AgentPay for
protocol-native settlement matching. All changes are **purely additive** — no
existing tables, columns, or indexes are modified except for one new nullable
column on `payment_intents`.

---

## 1. Schema Changes (`prisma/schema.prisma`)

### 1a. Extended `PaymentIntent` model

Two additions to the existing model (highlighted):

```diff
 model PaymentIntent {
   id                String    @id @db.Uuid
   merchantId        String    @map("merchant_id") @db.Uuid
   ...
+  // First-class protocol-specific external reference.
+  // Replaces the metadata->>'tx_hash' side-channel used by the Solana listener.
+  externalRef       String?   @map("external_ref")
   metadata          Json?
   ...
   merchant Merchant @relation(...)
   agent    Agent?   @relation(...)
+  settlementIdentities SettlementIdentity[]
+  resolution           IntentResolution?
 }
```

- `externalRef` — new nullable TEXT column. Populated when an agent submits a
  transaction hash via `POST /api/v1/payment-intents/:id/verify`. Mirrors what
  was previously buried in `metadata->>'tx_hash'`.
- `settlementIdentities` / `resolution` — Prisma back-relations required for
  the new FK relationships. **No new DB columns** — the FKs live on the child
  tables.

### 1b. New model: `SettlementIdentity`

```prisma
model SettlementIdentity {
  id          String    @id @default(uuid()) @db.Uuid
  intentId    String    @map("intent_id") @db.Uuid        // FK → payment_intents
  protocol    String                                       // solana | stripe | ap2 | x402 | acp | agent
  externalRef String?   @map("external_ref")              // txHash | stripeSessionId | ap2Token
  status      String    @default("pending")               // pending | confirmed | failed | expired
  settledAt   DateTime? @map("settled_at") @db.Timestamptz(6)
  metadata    Json?     @default("{}")
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  intent     PaymentIntent     @relation(...)
  events     SettlementEvent[]
  resolution IntentResolution?

  @@map("settlement_identities")
}
```

One record per `(intent, protocol)` pair. Provides the canonical link from a
payment intent to the external proof of settlement for a specific rail. Multiple
records are allowed per intent (e.g. a Solana attempt that failed followed by a
successful Stripe attempt).

### 1c. New model: `MatchingPolicy`

```prisma
model MatchingPolicy {
  id                String   @id @default(uuid()) @db.Uuid
  protocol          String
  matchStrategy     String   @map("match_strategy")       // by_recipient | by_memo | by_external_ref
  requireMemoMatch  Boolean  @default(false) @map("require_memo_match")
  confirmationDepth Int      @default(2) @map("confirmation_depth")
  ttlSeconds        Int      @default(1800) @map("ttl_seconds")
  isActive          Boolean  @default(true) @map("is_active")
  config            Json?    @default("{}")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@map("matching_policies")
}
```

Standalone config table. No FK to other models. Seeded at migration time (see
§2). Operators can `UPDATE` rows without deploying code.

### 1d. New model: `SettlementEvent`

```prisma
model SettlementEvent {
  id                   String    @id @default(cuid())
  settlementIdentityId String?   @map("settlement_identity_id") @db.Uuid  // nullable FK
  intentId             String?   @map("intent_id") @db.Uuid               // denormalised
  eventType            String    @map("event_type")
  protocol             String
  externalRef          String?   @map("external_ref")
  payload              Json      @default("{}")
  createdAt            DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  settlementIdentity SettlementIdentity? @relation(...)

  @@map("settlement_events")
}
```

Append-only event log. Mirrors `trust_events` for the settlement domain.
`intentId` is denormalised for fast per-intent queries without a join through
`settlement_identities`.

### 1e. New model: `IntentResolution`

```prisma
model IntentResolution {
  id                   String    @id @default(uuid()) @db.Uuid
  intentId             String    @unique @map("intent_id") @db.Uuid         // one per intent
  settlementIdentityId String?   @unique @map("settlement_identity_id") @db.Uuid
  protocol             String
  resolvedBy           String    @map("resolved_by")       // solana_listener | stripe_webhook | ap2_confirm | manual
  resolutionStatus     String    @map("resolution_status") // confirmed | failed | disputed | expired
  externalRef          String?   @map("external_ref")
  confirmationDepth    Int?      @map("confirmation_depth")
  payerRef             String?   @map("payer_ref")
  resolvedAt           DateTime  @map("resolved_at") @db.Timestamptz(6)
  metadata             Json?     @default("{}")
  createdAt            DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  intent             PaymentIntent       @relation(...)
  // onDelete: Restrict — prevents deleting the winning SettlementIdentity proof.
  settlementIdentity SettlementIdentity? @relation(..., onDelete: Restrict)

  @@map("intent_resolutions")
}
```

Written exactly once when the resolution engine finalises an intent's outcome.
`intentId` is unique — this is the single source of truth for "was intent X
paid?". `settlementIdentityId` is also unique — at most one `IntentResolution`
references each `SettlementIdentity`.

---

## 2. Migration Changes (`scripts/migrate.js`, migration `032_settlement_schema`)

Migration 032 applies the following SQL in a single transaction (idempotent
via `IF NOT EXISTS` guards):

| Step | SQL action | Table affected |
|------|-----------|----------------|
| 1 | `ADD COLUMN IF NOT EXISTS external_ref TEXT` + index + backfill | `payment_intents` |
| 2 | `CREATE TABLE IF NOT EXISTS` | `settlement_identities` |
| 3 | `CREATE TABLE IF NOT EXISTS` + seed rows | `matching_policies` |
| 4 | `CREATE TABLE IF NOT EXISTS` | `settlement_events` |
| 5 | `CREATE TABLE IF NOT EXISTS` | `intent_resolutions` |

### Seed data (`matching_policies`)

| Protocol | Strategy | Memo check | Depth | TTL (s) |
|----------|----------|-----------|-------|---------|
| `solana` | `by_recipient` | false | 2 | 1800 |
| `stripe` | `by_external_ref` | false | 0 | 3600 |
| `ap2` | `by_external_ref` | false | 0 | 300 |
| `x402` | `by_external_ref` | false | 0 | 300 |
| `acp` | `by_external_ref` | false | 0 | 1800 |
| `agent` | `by_external_ref` | false | 0 | 7200 |

The `requireMemoMatch = false` default for Solana preserves current behaviour.
When the Solana verification upgrade (Phase 3 item) is deployed, the operator
can flip this flag via `UPDATE matching_policies SET require_memo_match = true
WHERE protocol = 'solana'` without a code deploy.

---

## 3. Mapping: New Objects → Current Repo Models

| New object | Replaces / augments | Current repo touchpoint |
|-----------|--------------------|-----------------------|
| `settlement_identities.external_ref` | `payment_intents.metadata->>'tx_hash'` side-channel | `src/services/solana-listener.ts:78`, `src/routes/v1Intents.ts:245` |
| `settlement_identities.external_ref` | `transactions.stripe_payment_reference` for intent-level lookup | `src/routes/stripeWebhooks.ts` |
| `settlement_identities.status` | `payment_intents.status` (augments, does not replace) | `src/services/intentService.ts` |
| `matching_policies` | Hard-coded `CONFIRMATION_DEPTH`, `LISTENER_POLL_INTERVAL_MS` constants | `src/security/payment-verification.ts:8`, `src/services/solana-listener.ts:8` |
| `settlement_events` | Per-query `logger.info` calls in listener and webhook handler | `src/services/solana-listener.ts:143`, `src/routes/stripeWebhooks.ts:141` |
| `intent_resolutions` | No current equivalent — query was always `SELECT status FROM payment_intents` | `src/routes/verify.ts`, `apps/api-edge/src/routes/verify.ts` |
| `PaymentIntent.externalRef` | `payment_intents.metadata->>'tx_hash'` | `src/routes/v1Intents.ts:245` |
| `PaymentIntent.settlementIdentities` / `.resolution` | New back-relations (no current equivalent) | Added to Prisma model only |

---

## 4. What to Run Locally After This Phase

```bash
# 1. Apply the new migration to your local / staging database
node scripts/migrate.js

# 2. Regenerate the Prisma client so TypeScript picks up the new models
DATABASE_URL=<your-db-url> DIRECT_URL=<your-db-url> npx prisma generate

# 3. Confirm the new tables exist
psql $DATABASE_URL -c "\dt settlement_*" -c "\dt matching_*" -c "\dt intent_*"

# 4. Confirm the seed rows in matching_policies
psql $DATABASE_URL -c "SELECT protocol, match_strategy, ttl_seconds FROM matching_policies;"

# 5. Run the test suite to verify nothing is broken
npm test
```

> **Note:** `scripts/migrate.js` is idempotent — if migration `032_settlement_schema`
> has already been applied it will be skipped with a ⏭ message.

---

## 5. Commit Message

```
feat(schema): add settlement identity layer (Phase 2)

Adds four new tables and one new column to support protocol-native
settlement matching without modifying existing tables:

- settlement_identities  — links intents to protocol-specific proofs
- matching_policies      — per-protocol config, seeded for all 6 rails
- settlement_events      — append-only lifecycle event log
- intent_resolutions     — single source of truth for intent outcomes

Also adds payment_intents.external_ref (nullable TEXT) as a first-class
column to replace the metadata->>'tx_hash' side-channel.

Migration: 032_settlement_schema (scripts/migrate.js)
Schema:    prisma/schema.prisma
Docs:      docs/HYBRID_SETTLEMENT_PHASE2.md

No application code changed. No existing tables or columns removed.
All new columns are nullable or have safe defaults.
```
