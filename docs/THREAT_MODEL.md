# Threat Model — AgentPay

> **Version:** 1.0  
> **Last Updated:** 2026-03-10  
> **Methodology:** STRIDE + Attack Trees  
> **Scope:** AgentPay API backend, SDK, and dashboard

---

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────────┐
│  UNTRUSTED ZONE                                                       │
│  ┌─────────────┐  ┌───────────────┐  ┌───────────────────────────┐  │
│  │  AI Agents  │  │   Merchants   │  │  External Webhooks/APIs   │  │
│  └──────┬──────┘  └───────┬───────┘  └────────────┬──────────────┘  │
└─────────┼─────────────────┼──────────────────────┼──────────────────┘
          │  API Key Auth   │  API Key Auth         │  HTTPS only
          ▼                 ▼                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  DMZ / API LAYER (Express, rate-limited, Helmet)                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Auth Middleware → RBAC → Route Handlers → Services          │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│  TRUSTED ZONE                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────────┐ │
│  │  PostgreSQL DB  │  │  Stripe API     │  │  Solana RPC          │ │
│  │  (Render PG)    │  │  (external)     │  │  (external)          │ │
│  └─────────────────┘  └─────────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

**Key trust boundary rules:**
1. API keys are the primary identity claim from the untrusted zone
2. Admin secret is a separate credential for admin operations
3. All external service calls (Stripe, Solana) are treated as untrusted
4. Database is trusted only after parameterized query execution

---

## STRIDE Analysis

### Spoofing

| Threat | Vector | Mitigation | Status |
|--------|--------|-----------|--------|
| API key spoofing | Attacker guesses or brutes forces API key | PBKDF2 makes brute force infeasible; rate limiting on auth paths | ✅ Mitigated |
| Admin credential spoofing | Attacker guesses `ADMIN_SECRET_KEY` | Secrets must be ≥32 chars; startup validation enforces this | ✅ Mitigated |
| Agent identity spoofing | One agent impersonates another | `agentOwnership` checks in `agentOwnership.test.ts` | ✅ Mitigated |
| Webhook source spoofing | Attacker sends fake webhook events | HMAC-SHA256 signature on all outgoing webhooks; consumers must verify | ✅ Mitigated |
| Test mode bypass | Attacker uses `sk_test_sim` in production | `AGENTPAY_TEST_MODE=true` hard-blocked in production startup | ✅ Mitigated |

### Tampering

| Threat | Vector | Mitigation | Status |
|--------|--------|-----------|--------|
| Payment intent tampering | Attacker modifies amount/recipient in transit | TLS in transit; intent verified by token on completion | ✅ Mitigated |
| AgentRank score manipulation | Attacker calls adjust endpoint without auth | `requireRole(['admin'])` on adjust endpoint | ✅ Mitigated |
| Escrow amount tampering | Attacker modifies escrow amount after creation | Escrow amount fixed at creation; no update path | ✅ Mitigated |
| Audit log tampering | Attacker modifies audit log | No UPDATE/DELETE paths on `payment_audit_log` | ✅ Mitigated |

### Repudiation

| Threat | Vector | Mitigation | Status |
|--------|--------|-----------|--------|
| Agent denies completing work | Agent claims no output submitted | Output stored in `agent_transactions.output` JSON at complete time | ✅ Mitigated |
| Merchant denies payment | Merchant denies escrow release | Escrow status transitions logged with timestamps | ✅ Mitigated |
| Missing audit trail | No record of who did what | `payment_audit_log` + structured Pino logs with requestId | ✅ Mitigated |

### Information Disclosure

| Threat | Vector | Mitigation | Status |
|--------|--------|-----------|--------|
| Stack traces in 500 errors | Unhandled errors expose internals | Global error handler should strip stack traces in production | ⚠️ Verify |
| API key exposure in logs | Full key logged accidentally | Key prefix logged, never full key | ✅ Mitigated |
| Private key exposure | Custodial wallet key leaked | AES-256-GCM encrypted at rest | ✅ Mitigated |
| Cross-merchant data access | Merchant A reads Merchant B's data | All queries scoped to `merchant_id` from auth context | ✅ Mitigated |
| Error message enumeration | Error messages reveal user/agent existence | Verify 404 vs 401 responses don't enumerate valid IDs | ⚠️ Verify |

### Denial of Service

| Threat | Vector | Mitigation | Status |
|--------|--------|-----------|--------|
| API endpoint flood | High-volume unauthenticated requests | Global rate limiter (100/15min); Render DDoS protection | ✅ Mitigated |
| Webhook loop | Malicious agent registers webhook pointing to AgentPay itself | Webhook URL validation blocks known-bad patterns | ⚠️ Partial |
| Large payload | Attacker sends 100MB JSON body | `express.json({ limit: '1mb' })` — verify this limit exists | ⚠️ Verify |
| Reconciliation storm | Reconciliation daemon hammers DB on startup | Daemon runs with configurable interval | ✅ Mitigated |

### Elevation of Privilege

| Threat | Vector | Mitigation | Status |
|--------|--------|-----------|--------|
| Role escalation | Merchant self-assigns admin role | Role assignment is server-controlled; no user-facing endpoint | ✅ Mitigated |
| Admin endpoint exposure | Admin routes accessible without admin secret | `requireRole(['admin'])` + admin secret middleware | ✅ Mitigated |
| Test route in production | `/api/test` routes accessible in production | Hard-blocked: `AGENTPAY_TEST_MODE=true` rejected at startup | ✅ Mitigated |

---

## Attack Trees

### Attack Tree: Unauthorized Fund Release

```
Goal: Release escrow funds without being the authorized hirer

1. Compromise hirer's API key
   1a. Brute force → Blocked (PBKDF2 + rate limiting)
   1b. Phishing → External threat; mitigated by key rotation
   1c. Key in logs → Audit logs store prefix only

2. Exploit escrow route directly
   2a. No authentication → Blocked (auth middleware)
   2b. Replay old release request → Need: idempotency key check
   2c. Race condition: concurrent release → Need: DB-level locking

3. Exploit admin endpoint
   3a. Guess admin secret → Blocked (≥32 char requirement + rate limit)
   3b. Steal admin secret from env → Render secrets management
```

### Attack Tree: AgentRank Score Manipulation

```
Goal: Inflate your own AgentRank score fraudulently

1. Direct score manipulation
   1a. Call /adjust without admin role → Blocked (requireRole)
   1b. Forge admin role in JWT → JWT verified server-side

2. Synthetic transaction generation
   2a. Create fake completed transactions → Requires valid escrow flow
   2b. Self-hire attack → Detected by riskEngine (SELF_HIRE flag)
   2c. Sybil network of agents → Detected by LOW_COUNTERPARTY_DIVERSITY flag

3. Dispute abuse
   3a. Raise disputes on all transactions to penalize competitors → 
      Need: dispute rate cooldown, minimum score before disputes accepted
```

### Attack Tree: Webhook SSRF

```
Goal: Use webhook delivery to probe internal network

1. Register webhook with internal URL
   1a. http://169.254.169.254 (metadata server) → Need: IP validation
   1b. http://localhost:5432 (database) → validateWebhookUrl blocks localhost in prod
   1c. Internal service URLs → Need: SSRF blocklist

Mitigation gaps:
- validateWebhookUrl checks localhost but not RFC1918 ranges (10.x, 172.16.x, 192.168.x)
- Should add comprehensive SSRF protection
```

---

## Abuse Cases

| Abuse Case | Description | Current Defense |
|------------|-------------|-----------------|
| Sybil agents | Creating thousands of fake agents to inflate ecosystem stats | Registration requires valid merchant API key; rate limited |
| Fee evasion | Bypassing fee calculation on complete | Fee calculated server-side on escrow amount; not user-controlled |
| Dispute abuse | Filing disputes on all transactions to damage competitor reputation | Dispute rate tracked in AgentRank signals |
| Washing | Agent hires itself to inflate score | SELF_HIRE detected by riskEngine |
| Key resale | Merchant selling their API key to others | Single key per merchant; key rotation available |
| Test mode in staging | Developer accidentally deploys with `AGENTPAY_TEST_MODE=true` | Startup validation blocks in production; staging should mirror production config |

---

## Open Threats (Need Action)

1. **SSRF via webhook URLs** — validate against RFC1918 address ranges, not just localhost
2. **Race condition on escrow release** — add database-level locking or optimistic concurrency
3. **Replay attacks on AP2** — add nonce or timestamp validation at the AP2 protocol layer
4. **Body size limit** — verify `express.json({ limit: '1mb' })` is set
5. **Secrets scanning in CI** — add `trufflesecurity/trufflehog` or similar to CI pipeline
