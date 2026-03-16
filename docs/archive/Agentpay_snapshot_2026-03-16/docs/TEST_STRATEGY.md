# Test Strategy — AgentPay

> **Version:** 1.0  
> **Last Updated:** 2026-03-10  
> **Owner:** Engineering

---

## Philosophy

Tests at AgentPay exist to provide real confidence, not superficial coverage numbers.

Every test must:
1. Verify a behavior that could fail in production
2. Run deterministically (no flakiness)
3. Clean up after itself

We do not:
1. Write tests just to increase coverage percentage
2. Mock the database in integration tests
3. Use `forceExit` to mask async cleanup issues (exception: `--forceExit` is required for `pg.Pool` lifecycle; document this explicitly)

---

## Test Pyramid

```
         /──────────────────────\
        /   E2E (golden paths)    \      ~5% — Critical flows only
       /────────────────────────────\
      /   Integration (DB + routes)   \  ~35% — Route + service tests
     /──────────────────────────────────\
    /     Unit (services + utils)        \ ~60% — Fast, isolated, thorough
   /────────────────────────────────────────\
```

---

## Test Types and Locations

### Unit Tests (`tests/unit/`)

**Purpose:** Test individual services and utilities in isolation  
**DB mocking:** Mock `src/db/index` and `src/lib/prisma` with jest mocks  
**Speed:** Fast (<1s per test)

Key unit test files:
- `feeService.test.ts` — Fee calculation correctness, edge cases
- `riskEngine.test.ts` — Risk tier classification, signal aggregation
- `agentrankService.test.ts` — Score computation, grade assignment
- `agentrankCore.test.ts` — Core scoring invariants
- `reconciliationService.test.ts` — Reconciliation logic
- `webhookValidation.test.ts` — HMAC signature verification
- `walletEncryption.test.ts` — AES-256-GCM encrypt/decrypt
- `sanitizeIntent.test.ts` — Output encoding, XSS prevention
- `spendingPolicy.test.ts` — Spending limit enforcement
- `delegationService.test.ts` — Sub-agent delegation chains
- `intentService.test.ts` — Payment intent state machine
- `metrics.test.ts` — Prometheus metric registration

### Route Integration Tests (`tests/routes/`, `tests/*.test.ts`)

**Purpose:** Test Express routes end-to-end with supertest  
**DB mocking:** Mock DB for non-integration tests; use real DB for DB tests  
**Speed:** Medium (may require DB setup)

Key route test files:
- `escrow-route.test.ts` — Escrow lifecycle (create, approve, dispute)
- `agent-network-routes.test.ts` — Agent hire/complete flows
- `agentrank-route.test.ts` — AgentRank CRUD and history
- `integration.test.ts` — End-to-end payment flow (requires real DB)
- `api-status.test.ts` — Health, version, and status endpoints
- `trust-payment-flow.test.ts` — Full hire→complete→settle flow

### Security Tests (`tests/security/`)

**Purpose:** Verify security controls work correctly  
**Critical — never skip these**

- `authMiddleware.test.ts` — Invalid keys rejected, valid keys accepted
- `webhookSignature.test.ts` — Signature forgery rejected, valid sigs accepted
- `pbkdf2Validation.test.ts` — PBKDF2 correctness and strength
- `agentOwnership.test.ts` — Cross-agent action prevented
- `receiptSanitization.test.ts` — XSS in receipt data prevented

### Protocol Tests (`tests/protocols.test.ts`)

**Purpose:** Verify x402, ACP, AP2 protocol adapters

### Reputation Tests (`tests/reputation.test.ts`)

**Purpose:** Integration tests for reputation system with real DB

---

## Critical Test Invariants

The following invariants must be tested and never broken:

### Financial Invariants

1. **Fee calculation is deterministic** — same input always produces same fee
2. **Fee is always non-negative** — no scenario should produce negative fees
3. **Escrow amount + fees ≤ total charged** — no over-charging
4. **Dispute payout ≤ escrow amount** — `worker_payout + hirer_refund ≤ amount_usdc`
5. **AgentRank score is 0–1000** — never outside this range

### Security Invariants

6. **Invalid API key always returns 401** — no bypass possible
7. **Admin endpoints require admin role** — no merchant can access admin routes
8. **Webhook signature forgery returns 400** — invalid sigs rejected
9. **Cross-merchant data access returns 403** — strict scoping

### Idempotency Invariants

10. **Duplicate payment intent creation is safe** — same idempotency key returns same result
11. **Escrow can only be approved once** — double-release prevented

---

## Test Infrastructure

### Database Setup for CI

CI spins up a fresh PostgreSQL 15 instance per run. Tests that require a real DB must:
1. Not mock `src/db/index` or `src/lib/prisma`
2. Clean up their test data (or use isolated schema prefixes)

Tests that should NOT use a real DB:
- Unit tests in `tests/unit/`
- Security tests in `tests/security/` (route-level)

### Jest Configuration

```javascript
// jest.config.js
{
  testEnvironment: 'node',
  transform: { '^.+\\.tsx?$': ['ts-jest', ...] },
  // forceExit required because pg.Pool keeps connections alive
  // This is expected behavior, not a test isolation problem
}
```

**Important:** `--forceExit` is passed in `npm test` specifically because `pg.Pool` keeps connections alive after tests finish. This is a known limitation, not a sign of test cleanup issues.

### Mocking Rules

| Test type | Mock `src/db/index`? | Mock `src/lib/prisma`? | Real DB? |
|-----------|---------------------|----------------------|---------|
| Unit | ✅ Yes | ✅ Yes | ❌ No |
| Route (no DB) | ✅ Yes | ✅ Yes | ❌ No |
| Route (with DB) | ❌ No | ❌ No | ✅ Yes |
| Integration | ❌ No | ❌ No | ✅ Yes |
| E2E | ❌ No | ❌ No | ✅ Yes |

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
| Statements | ≥80% | ~varies |
| Branches | ≥70% | ~varies |
| Lines | ≥80% | ~varies |

Coverage is reported but not enforced as a hard gate currently. The goal is meaningful coverage of critical paths, not coverage theater.

---

## Gaps to Address

1. **Property tests for financial invariants** — use `fast-check` to test fee/score calculations with random inputs
2. **Concurrency tests** — test that double-release of escrow is prevented under concurrent requests
3. **Migration smoke tests** — add a dedicated test that runs create-db.js + migrate.js on a fresh DB
4. **Webhook retry tests** — test that failed webhook deliveries are retried correctly
5. **Admin action tests** — test that all admin actions are properly logged to audit log
