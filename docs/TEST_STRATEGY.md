# Test Strategy - AgentPay

> **Version:** 1.1
> **Last Updated:** 2026-04-02
> **Owner:** Engineering

---

## Philosophy

Tests at AgentPay exist to provide real confidence, not superficial coverage numbers.

Every test must:
1. Verify a behavior that could fail in production
2. Run deterministically with no flakiness
3. Clean up after itself

We do not:
1. Write tests just to increase coverage percentage
2. Mock the database in integration tests
3. Use `forceExit` to mask async cleanup issues, except where `pg.Pool` lifecycle requires it and that is documented explicitly

---

## Test Pyramid

```text
         /----------------------\
        /   E2E (golden paths)   \      ~5% - Critical flows only
       /--------------------------\
      / Integration (DB + routes) \     ~35% - Route + service tests
     /------------------------------\
    /   Unit (services + utils)      \   ~60% - Fast, isolated, thorough
   /----------------------------------\
```

---

## Test Types and Locations

### Unit Tests (`tests/unit/`)

**Purpose:** Test individual services and utilities in isolation
**DB mocking:** Mock `src/db/index` and `src/lib/prisma` with jest mocks
**Speed:** Fast, usually under 1 second per test

Key unit test files:
- `feeService.test.ts` - fee calculation correctness and edge cases
- `riskEngine.test.ts` - risk tier classification and signal aggregation
- `agentrankService.test.ts` - score computation and grade assignment
- `agentrankCore.test.ts` - core scoring invariants
- `reconciliationService.test.ts` - reconciliation logic
- `webhookValidation.test.ts` - HMAC signature verification
- `walletEncryption.test.ts` - AES-256-GCM encrypt/decrypt
- `sanitizeIntent.test.ts` - output encoding and XSS prevention
- `spendingPolicy.test.ts` - spending limit enforcement
- `delegationService.test.ts` - sub-agent delegation chains
- `intentService.test.ts` - payment intent state machine
- `metrics.test.ts` - Prometheus metric registration

### Route Integration Tests (`tests/routes/`, `tests/*.test.ts`)

**Purpose:** Test routes end-to-end with supertest
**DB mocking:** Mock DB for non-integration tests, use real DB for DB tests
**Speed:** Medium, may require DB setup

Key route test files:
- `escrow-route.test.ts` - escrow lifecycle
- `agent-network-routes.test.ts` - agent hire/complete flows
- `agentrank-route.test.ts` - AgentRank CRUD and history
- `integration.test.ts` - end-to-end payment flow with real DB
- `api-status.test.ts` - health, version, and status endpoints
- `trust-payment-flow.test.ts` - hire to complete to settle flow

### Security Tests (`tests/security/`)

**Purpose:** Verify security controls work correctly
**Critical:** Never skip these

- `authMiddleware.test.ts` - invalid keys rejected, valid keys accepted
- `webhookSignature.test.ts` - signature forgery rejected
- `pbkdf2Validation.test.ts` - PBKDF2 correctness and strength
- `agentOwnership.test.ts` - cross-agent action prevented
- `receiptSanitization.test.ts` - XSS in receipt data prevented

### Protocol Tests (`tests/protocols.test.ts`)

**Purpose:** Verify x402, ACP, and AP2 protocol adapters

### Reputation Tests (`tests/reputation.test.ts`)

**Purpose:** Integration tests for the reputation system with a real DB

---

## Critical Test Invariants

The following invariants must be tested and never broken:

### Financial Invariants

1. Fee calculation is deterministic
2. Fee is always non-negative
3. Escrow amount plus fees is never greater than the total charged
4. Dispute payout is never greater than the escrow amount
5. AgentRank score stays within 0 to 1000

### Security Invariants

6. Invalid API keys always return `401`
7. Admin endpoints require admin role
8. Webhook signature forgery returns `400`
9. Cross-merchant data access returns `403`

### Idempotency Invariants

10. Duplicate payment intent creation is safe
11. Escrow can only be approved once

---

## Test Infrastructure

### Database Setup for CI

CI spins up a fresh PostgreSQL 15 instance per run. Tests that require a real DB must:
1. Avoid mocking `src/db/index` or `src/lib/prisma`
2. Clean up their test data, or use isolated schema prefixes

Tests that should not use a real DB:
- Unit tests in `tests/unit/`
- Security tests in `tests/security/` at route level

### Jest Configuration

```javascript
{
  testEnvironment: 'node',
  transform: { '^.+\\.tsx?$': ['ts-jest', /* ... */] },
  // forceExit is only used because pg.Pool can keep connections alive
}
```

`--forceExit` in `npm test` is a known limitation of `pg.Pool`, not a sign that tests are masking cleanup bugs.

### Mocking Rules

| Test type | Mock `src/db/index`? | Mock `src/lib/prisma`? | Real DB? |
|-----------|----------------------|------------------------|----------|
| Unit | Yes | Yes | No |
| Route (no DB) | Yes | Yes | No |
| Route (with DB) | No | No | Yes |
| Integration | No | No | Yes |
| E2E | No | No | Yes |

---

## Running Tests

```bash
# All tests
npm test

# Security tests only
npm run test:security

# Watch mode
npm run test:watch

# With coverage
npm test -- --coverage

# Specific file
npx jest tests/escrow-route.test.ts
```

---

## Coverage Goals

| Category | Target | Current |
|----------|--------|---------|
| Statements | >=80% | varies |
| Branches | >=70% | varies |
| Lines | >=80% | varies |

Coverage is reported but not enforced as a hard gate currently. The goal is meaningful coverage of critical paths, not coverage theater.

---

## Gaps to Address

1. **Property tests for financial invariants** - use `fast-check` for fee and score calculations
2. **Concurrency tests** - verify double-release of escrow is prevented under concurrent requests
3. **Migration smoke tests** - run create-db plus migrate on a fresh DB
4. **Webhook retry tests** - verify failed webhook deliveries are retried correctly
5. **Admin action tests** - ensure admin actions are properly logged to the audit log

---

## Ace Mobile Product QA Matrix

Meridian should be checked like a product, not just a bundle that compiles.

These cases are the manual release gate for user-facing Ace changes.

### 1. Fresh Install

**Goal:** First impression feels premium and coherent.

Check:
- Boot/loading brand object matches the current Ace system
- Onboarding teaches the same interaction model as the live app
- Name capture, first prompt, and permissions feel calm and inevitable

### 2. Returning User, No Live Trip

**Goal:** Ace feels ready instantly.

Check:
- App lands in the main conversation surface cleanly
- Presence object feels intentional, not generic or bolted on
- Voice loop and fallback typing both remain available

### 3. Live Journey Resume

**Goal:** Continuity wins over ceremony.

Check:
- App resumes the active trip instead of replaying onboarding or idle listening
- Journey, status, and receipt all preserve the same trip spine
- Recovery states still feel owned by Ace

### 4. Microphone Denied

**Goal:** Failure language stays premium.

Check:
- Copy avoids infrastructure wording or debugging language
- Typed fallback is obvious and usable
- App does not get stuck in a broken voice state

### 5. Slow or Failing Network

**Goal:** Trust survives latency.

Check:
- Ace does not feel frozen or ambiguous during planning or execution
- Errors use calm recovery language
- Confirm and execute never leave the user unsure whether a booking happened

### 6. Speaking / Listening Sync

**Goal:** Presence feels alive, not decorative.

Check:
- Ace reacts when the user is actually speaking
- Ace speaking animation aligns with real playback, not request start
- No old hold-to-talk assumptions leak into the flow

### 7. Confirm / Execute

**Goal:** Delegation feels controlled.

Check:
- Summary, price, and approval cues are clear
- Payment and execution transitions are trustworthy
- Retry, manual review, and rollback states still preserve continuity

### 8. Reroute / Notification Re-entry

**Goal:** Disruptions become next actions.

Check:
- Notification tap lands in the right screen immediately
- Reroute offers are specific, not generic alerts
- Re-entry preserves context and tone

### 9. Older iPhone Sweep

**Goal:** Premium survives constrained hardware.

Check:
- No clipping, top-left drift, or cropped visual objects
- Performance remains stable on older devices
- Visual hierarchy still reads on smaller screens

### 10. Final Taste Pass

**Goal:** Remove seams before shipping.

Check:
- No stale "Bro" naming or internal system language
- No generic dots, placeholder avatars, or old assets leaking through
- No surface teaches one interaction while another screen expects something else
- If the real ceiling is an art source, say so instead of over-tuning code
