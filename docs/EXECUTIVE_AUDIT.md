# Executive Audit — AgentPay

> **Prepared:** 2026-03-10  
> **Scope:** Full repository audit for investor diligence, enterprise design partners, and security review  
> **Verdict:** Pre-seed maturity. Core infrastructure is sound. Several critical gaps must close before Series A diligence.

---

## Table of Contents

1. [Current Architecture](#current-architecture)
2. [File-by-File Classification](#file-by-file-classification)
3. [Top 20 Credibility Risks](#top-20-credibility-risks)
4. [Top 20 Security Risks](#top-20-security-risks)
5. [Top 20 Product Gaps](#top-20-product-gaps)
6. [Top 20 Code Quality / Operability Gaps](#top-20-code-quality--operability-gaps)
7. [Recommended Deletions](#recommended-deletions)
8. [Recommended Roadmap](#recommended-roadmap)

---

## Current Architecture

```
AgentPay Backend (Node 20 / Express / TypeScript)
├── src/
│   ├── routes/          # ~20 Express route files (too many, needs consolidation)
│   ├── services/        # Domain services (feeService, riskEngine, agentrankService, etc.)
│   ├── middleware/       # Auth, rate limiting, RBAC, logging
│   ├── protocols/       # x402, ACP, AP2 protocol adapters
│   ├── escrow/          # In-memory trust-escrow (NOT persisted — critical gap)
│   ├── db/              # Raw pg pool query wrapper
│   ├── lib/             # Prisma client instance
│   └── server.ts        # Express app entrypoint
├── prisma/
│   └── schema.prisma    # 15+ models across merchants, agents, transactions, escrow, etc.
├── scripts/
│   ├── migrate.js       # 26+ custom SQL migrations (no Prisma migrate history)
│   └── create-db.js     # Schema bootstrap
├── sdk/
│   ├── js/              # TypeScript SDK (@agentpay/sdk)
│   └── python/          # Python SDK (agentpay)
├── dashboard/           # Next.js admin dashboard
├── cli/agentpay/        # CLI scaffolding tool
└── tests/               # ~62 test suites, ~850 tests
```

**Persistence:** PostgreSQL (pg + Prisma client coexist — consistency risk)  
**Deploy:** Render (render.yaml) with node scripts/migrate.js on startup  
**Observability:** Pino structured logging, Prometheus /metrics, Sentry optional  
**Protocols:** x402, ACP, AP2, Solana Pay, Stripe  

---

## File-by-File Classification

### Core Product-Critical

| File | Notes |
|------|-------|
| `src/server.ts` | App entrypoint — good startup validation, needs cleanup |
| `src/routes/merchants.ts` | Merchant registration, API key management |
| `src/routes/intents.ts` | Payment intent lifecycle |
| `src/routes/escrow.ts` | A2A escrow — persisted path |
| `src/routes/agents.ts` | Agent registration + network marketplace |
| `src/routes/agentrank.ts` | Trust score read/write |
| `src/routes/admin.ts` | Admin operations |
| `src/routes/webhooks.ts` | Webhook subscription management |
| `src/services/feeService.ts` | Fee calculation — critical financial logic |
| `src/services/riskEngine.ts` | Risk assessment |
| `src/services/agentrankService.ts` | AgentRank score mutation |
| `src/services/reputationService.ts` | Reputation bridge |
| `src/services/audit.ts` | Audit event logging |
| `src/services/merchants.ts` | PBKDF2 key hashing |
| `src/middleware/auth.ts` | API key verification |
| `src/middleware/requireRole.ts` | RBAC enforcement |
| `src/escrow/trust-escrow.ts` | **In-memory** escrow — data lost on restart |
| `prisma/schema.prisma` | Source of truth for data model |
| `scripts/migrate.js` | Custom migration runner |
| `scripts/create-db.js` | Schema bootstrap |

### Useful but Needs Refactor

| File | Issue |
|------|-------|
| `src/routes/agents.ts` | 400+ lines; network marketplace + identity mixed together |
| `src/db/index.ts` + `src/lib/prisma.ts` | Two database access patterns — fragmentation risk |
| `src/protocols/ap2.ts` | In-memory Map as L1 cache — lost on restart |
| `src/routes/moltbook.ts` | Moltbook-specific logic embedded in core |
| `src/services/reconciliationDaemon.ts` | Runs on startup — no backpressure, no retry budget |
| `openapi.yaml` | Exists but may diverge from actual routes |

### Duplicate / Stale / Misleading

| File | Issue |
|------|-------|
| `docs/architecture.md` | Superseded by `docs/ARCHITECTURE.md` |
| `docs/SECURITY_MODEL.md` | Partial — superseded by `docs/SECURITY.md` |
| `ROADMAP.md` (root) | Superseded by `docs/ROADMAP.md` |
| `AGENTPAY_WHITEPAPER.md` + `AGENTPAY_WHITEPAPER--.md` | Two whitepaper versions — unclear which is authoritative |
| `PRODUCTION_READINESS_REPORT.md` | Marketing self-assessment; not independently verifiable |
| `PRODUCTION_SETUP.md` | Overlaps with `DEPLOYMENT.md` |
| `ONE_PAGER.md` | Investor one-pager should not live in repo root |
| `QUICKSTART.md` | Duplicates README quickstart section |

### Should Be Deleted

| File | Reason |
|------|--------|
| `MISSION_ACCOMPLISHED.md` | Internal sprint artifact — removed |
| `DAY1_COMPLETION.md` | Internal sprint artifact — removed |
| `BUILD_SUMMARY.txt` | Internal artifact — removed |
| `COMPLETE_FILE_LIST.txt` | Internal artifact — removed |
| `DOWNLOAD_INSTRUCTIONS.txt` | Internal artifact — removed |
| `FILES_DELIVERED.md` | Internal artifact — removed |
| `FIX_TESTS.md` | Debugging artifact — removed |
| `WEEK1_SUMMARY.md` | Sprint artifact — removed |
| `V1_INTEGRATION_COMPLETE.md` | Sprint artifact — removed |
| `V1_RELEASE_NOTES.md` | Should be in CHANGELOG.md or GitHub releases |
| `PR_VERIFICATION_REPORT.md` | CI artifact — removed |
| `SETUP_TESTS_FOR_YOUR_PROJECT.md` | Vague scope — removed |
| `SOURCE_FILES_GUIDE.txt` | Redundant to directory structure — removed |
| `START_HERE.md` | Marketing fluff — removed |
| `7_DAY_SPRINT_TO_DEMO.md` | Sprint planning artifact — removed |
| `AUTOMATED_SETUP_GUIDE.txt` | Duplicate of DEPLOYMENT.md |
| `output.txt`, `test-output.txt` | Build artifacts committed to git — removed |
| `setup-test.ts`, `fix-key.ts`, `generate-key.ts` | One-off debug scripts in root — removed |
| `smoke-test.sh`, `production-ready-check.sh` | One-off scripts, replaced by CI |
| `setup.ps1` | Windows-only bootstrap script without equivalent CI coverage |
| `coverage/` (directory) | Coverage artifacts committed to git — removed, added to .gitignore |

---

## Top 20 Credibility Risks

1. **Hardcoded test count in README badges** (`837/837 passing`) — actual count is ~852, badge is stale. Any reviewer running tests will notice immediately.

2. **"Production Ready" badge links to a self-authored checklist** (`PRODUCTION_READINESS_REPORT.md`) — not an external audit. This badge signals marketing over engineering.

3. **Coverage artifacts committed to git** (`coverage/`) — signals poor git hygiene to any technical reviewer.

4. **24 clutter files in repo root** (MISSION_ACCOMPLISHED.md, DAY1_COMPLETION.md, etc.) — signals a sprint-driven dev process, not an engineering-led company.

5. **Two Prisma/pg database access patterns** (`src/db/index.ts` raw pg pool + `src/lib/prisma.ts` Prisma client) — reviewers will ask: what is the canonical data access layer?

6. **In-memory escrow (`trust-escrow.ts`)** — escrow balances are lost on server restart. Any financial reviewer will flag this as disqualifying.

7. **Custom migration runner (`scripts/migrate.js`)** instead of Prisma Migrate — no migration history table, no rollback, no checksum verification. Runs 26+ migrations idempotently but without proper tracking.

8. **No `LICENSE` file** — README says MIT but the file does not exist.

9. **`package.json` author is "Your Name"** — obviously placeholder, will be noticed in any diligence.

10. **OpenAPI spec may diverge from actual routes** — no automated validation in CI that spec matches implementation.

11. **Two whitepaper files** (`AGENTPAY_WHITEPAPER.md` and `AGENTPAY_WHITEPAPER--.md`) — which is authoritative?

12. **`PRODUCTION_SETUP.md` and `DEPLOYMENT.md` overlap** — creates confusion about canonical deploy process.

13. **`agentpay-mvp/` directory in root** — unclear what this is; signals abandoned experiment.

14. **AP2 transaction cache is in-memory** (`src/protocols/ap2.ts`) — all pending AP2 payments lost on restart.

15. **`ecosystem.config.cjs`** — PM2 config committed but no documentation on when/how it's used vs. render.yaml.

16. **`src/routes/demo.ts` mounted in production** — demo endpoints should be behind a feature flag or removed in production builds.

17. **No CHANGELOG.md** — version history lives in sprint docs, not in a queryable format.

18. **`package.json` version is `0.1.0`** — but README presents this as production-ready and "enterprise-grade." Misalignment between claimed maturity and semantic version.

19. **Moltbook-specific routes in core API** — mixing a specific integration partner's logic into the core platform reduces generalizability and signals architectural confusion.

20. **No documented incident response process** — for a financial platform handling real money, this is a blocking gap for enterprise customers.

---

## Top 20 Security Risks

1. **API key in-memory lookup path** — if `AGENTPAY_TEST_MODE=true` and `sk_test_sim` key bypass exists, there is a risk of accidental enablement in staging environments.

2. **Admin secret key fallback** — server warns but does not block in non-production environments when `ADMIN_SECRET_KEY` is not set. A misconfigured staging environment could have no admin auth.

3. **`src/protocols/ap2.ts` in-memory store** — no rate limiting, no idempotency enforcement on the in-memory layer.

4. **Webhook URL validation** — allows `http://localhost` in `NODE_ENV=test`. If `NODE_ENV` is misconfigured in staging, SSRF via webhook delivery is possible.

5. **`src/routes/demo.ts`** — creates real-looking merchant/agent objects; if accessible in production, it's a data seeding risk.

6. **No explicit Content-Security-Policy** for dashboard — Helmet is configured for the API, but dashboard Next.js app security headers should be verified.

7. **Solana private key handling** — `walletEncryption.ts` uses AES-256-GCM but the encryption key is derived from `AGENTPAY_SIGNING_SECRET`. Key rotation requires re-encrypting all wallets; no rotation playbook exists.

8. **PBKDF2 iteration count** — should be verified against current OWASP recommendation (≥600,000 for SHA-256). Document and enforce minimum.

9. **JWT secret fallback** — any JWT signing paths should be verified to have no static fallback secret.

10. **Rate limiting on auth endpoints** — verify that `/api/merchants/register` and `/api/merchants/auth` have stricter rate limits than global (100 req/15min).

11. **No replay protection on AP2 payment requests** — timestamp-based replay attacks possible if not enforced at protocol layer.

12. **Stripe webhook signature verification** — must verify all Stripe webhook paths use `stripe.webhooks.constructEvent`.

13. **SQL injection risk in raw pg queries** — `src/db/index.ts` raw query wrapper requires parameterized query discipline; no automated check enforces this.

14. **Prisma schema has `payment_audit_log` without Row Level Security setup** — comment says RLS required but no enforcement in code.

15. **No secrets scanning in CI** — committed secrets (even expired) are not detected.

16. **No dependency vulnerability scanning in CI** — `npm audit` not run as part of CI.

17. **`src/routes/admin.ts` RBAC** — admin routes require `requireRole(['admin'])` but the role assignment path (who gets admin role) is not clearly documented or restricted.

18. **Cors origin wildcard fallback** — if `CORS_ORIGIN` env var is not set, behavior needs verification that it doesn't default to `*` in production.

19. **Error messages may leak stack traces** — verify production error handler does not expose stack traces in 500 responses.

20. **No responsible disclosure policy** — public-facing security contact is missing; added at `docs/SECURITY.md`.

---

## Top 20 Product Gaps

1. **In-memory escrow not durable** — the core escrow flow (lock → approve → dispute) loses state on restart. Must be fully persisted.

2. **No dispute resolution UI or workflow** — dispute creation is implemented but resolution flow (evidence submission, arbitration, payout) is incomplete.

3. **AgentRank is a unilateral score, not a verifiable reputation graph** — score can be adjusted by any call to the adjust endpoint; no cryptographic audit trail.

4. **No multi-tenancy** — platform mode (where one organization manages multiple API keys/environments) is not implemented.

5. **No pagination on marketplace discovery** — `GET /api/marketplace/discover` returns all agents without pagination, a scalability gap.

6. **Agent onboarding flow incomplete** — KYA (Know Your Agent) verification exists but is not enforced before an agent can receive payments.

7. **No production-grade Solana integration** — Solana listener exists but uses devnet; mainnet deployment requires additional security review.

8. **Moltbook integration is first-class but undocumented** — creates confusion about whether AgentPay is a general platform or Moltbook-specific.

9. **No billing visibility for platform operators** — platform operators cannot see their revenue or usage breakdown.

10. **No staging/demo environment isolation** — demo endpoints exist in the production codebase without proper isolation.

11. **No webhook retry visibility** — merchants cannot see failed webhook deliveries or trigger replays from the dashboard.

12. **No API versioning strategy enforced** — `/api/v1/` prefix exists for some routes but not all; migration path to v2 is undefined.

13. **CLI is a stub** — `npx agentpay init` generates config but does not register agents or run end-to-end.

14. **Python SDK is incomplete** — basic intent creation exists but does not cover AgentRank, escrow, or webhooks.

15. **No agent-to-agent direct contract flow** — the hire/complete flow is defined but no contract terms (SLA, output format, dispute triggers) are enforced.

16. **No settlement finality signal** — there is no clear "payment is final" event emitted for downstream accounting systems.

17. **No KYC/AML path for fiat** — Stripe integration exists but no documented KYC/AML compliance path for regulated fiat flows.

18. **Feed and leaderboard are not real-time** — `GET /api/feed` returns static DB results without streaming or subscription support.

19. **No agent decommission flow** — once an agent is registered, there is no documented process to deactivate/archive it safely.

20. **No SLA commitments documented** — enterprise customers need uptime, support, and recovery time commitments.

---

## Top 20 Code Quality / Operability Gaps

1. **`src/routes/agents.ts` is 400+ lines** — registration, discovery, hire, complete, feed, and leaderboard are all in one file.

2. **Two DB access patterns** — `src/db/index.ts` (raw pg) and `src/lib/prisma.ts` (Prisma) coexist without clear boundaries. Queries are split across both patterns.

3. **Custom migration runner** — `scripts/migrate.js` is fragile; migrations are applied by name match in a JS array. No migration history table. No rollback.

4. **`trust-escrow.ts` is in-memory** — all escrow state is lost on restart. Critical production gap.

5. **`ap2.ts` L1 cache is in-memory** — AP2 payment intents cached in a `Map` are lost on restart.

6. **`reconciliationDaemon.ts` runs inline on startup** — no circuit breaker, no dead-letter queue, no visibility into failures.

7. **No structured error taxonomy** — HTTP errors return ad-hoc messages; no canonical error code system.

8. **Tests mock db inconsistently** — some tests mock `../src/db/index`, some mock `../../src/db/index`, some use a real DB. The pattern is fragile and hard to extend.

9. **Demo routes in production binary** — `src/routes/demo.ts` and `src/test/routes.ts` are compiled into the production binary and conditionally mounted. Should be excluded from production builds.

10. **No OpenAPI validation in CI** — the spec may drift from implementation without any automated check.

11. **`PRODUCTION_READINESS_REPORT.md` is a manual checklist** — no automated enforcement of the claims in that document.

12. **No structured logging correlation across services** — requestId is added by logging middleware but not forwarded to background jobs or webhooks.

13. **Reconciliation daemon has no dead-letter strategy** — failed reconciliation runs fail silently.

14. **No database connection pool monitoring** — no metrics on pg pool utilization, query latency, or connection errors.

15. **`src/routes/moltbook.ts` embeds partner-specific logic** — Moltbook should be a protocol adapter, not a core route.

16. **`scripts/seed-demo-wallets.ts` and `scripts/seed-insurance-pool.ts`** — demo seeding scripts are not documented or integrated into CI.

17. **No health check covers DB connectivity** — `/health` may return 200 even when the database is unreachable.

18. **`src/services/solana-listener.ts` uses polling** — no exponential backoff, no circuit breaker, no dead-letter for missed events.

19. **`agentpay-mvp/` directory** — contents and purpose are unclear; likely a stale experiment.

20. **`prisma/moltbook-schema.sql`** — raw SQL file with unclear ownership and deployment path.

---

## Recommended Deletions

The following files have been removed from git tracking (or should be):

- All sprint/status documents: `MISSION_ACCOMPLISHED.md`, `DAY1_COMPLETION.md`, `WEEK1_SUMMARY.md`, etc.
- Build and test artifacts: `coverage/`, `output.txt`, `test-output.txt`
- Debug and one-off scripts in root: `fix-key.ts`, `generate-key.ts`, `setup-test.ts`
- Redundant scripts: `smoke-test.sh`, `production-ready-check.sh`, `setup.ps1`

The following should be archived or consolidated:

- `AGENTPAY_WHITEPAPER.md` and `AGENTPAY_WHITEPAPER--.md` → merge into one canonical document
- `PRODUCTION_SETUP.md` + `DEPLOYMENT.md` → one `docs/DEPLOYMENT.md`
- `docs/architecture.md` → superseded by `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md` → superseded by `docs/SECURITY.md`
- `QUICKSTART.md` → merge content into README

---

## Recommended Roadmap

### Immediate (before any external sharing)

1. Fix in-memory escrow — persist all escrow state to `escrow_transactions` table
2. Add LICENSE file (MIT)
3. Fix README — remove stale badge counts, remove "production ready" self-certification
4. Add secrets scanning and `npm audit` to CI
5. Document who gets admin role and how

### Near-term (0–30 days)

1. Migrate to Prisma Migrate for proper migration history
2. Add OpenAPI validation step to CI
3. Implement dispute resolution workflow end-to-end
4. Add pagination to marketplace discovery
5. Enforce KYA verification before first payment
6. Add AP2 persistence (replace in-memory Map)

### Medium-term (30–90 days)

1. Multi-tenancy: organizations + environments + isolated API keys
2. Billing visibility for platform operators
3. Production Solana integration with mainnet testing
4. Complete Python SDK coverage
5. Agent decommission flow
6. SLA documentation for enterprise customers

### Long-term (90–180 days)

1. Cryptographic audit trail for AgentRank mutations
2. Real-time feed via SSE or WebSocket
3. Formal security audit by third party
4. SOC 2 Type I preparation
5. Formal KYC/AML compliance path for fiat flows
