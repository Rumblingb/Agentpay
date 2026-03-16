# Roadmap — AgentPay

> **Version:** 1.0  
> **Last Updated:** 2026-03-10  
> **Format:** Milestone-based. No specific dates beyond horizon estimates.

---

## Guiding Principles

1. **Fix before adding** — close critical infrastructure gaps before new features
2. **Trust is the product** — every milestone should improve verifiability and trust
3. **Honest timelines** — we estimate, not promise

---

## Current Milestone: Infrastructure Integrity

**Goal:** Make every claimed capability actually work end-to-end with no in-memory state.

### P0 (This Sprint)
- [ ] Persist all escrow state to `escrow_transactions` table — remove reliance on in-memory `trust-escrow.ts`
- [ ] Persist AP2 payment intents to database — remove in-memory Map
- [ ] Fix README — remove stale test counts, remove "production ready" self-certification badge
- [ ] Add `coverage/` to `.gitignore` — remove committed coverage artifacts
- [ ] Remove clutter files from repository root
- [ ] Add CODEOWNERS and branch protection guidance
- [ ] Add secrets scanning to CI

### P1 (Next 30 Days)
- [ ] Add OpenAPI validation step to CI (detect spec drift)
- [ ] Add `npm audit` to CI (dependency vulnerability scanning)
- [ ] Health endpoint database connectivity check (readiness probe)
- [ ] Add body size limit enforcement (`express.json({ limit: '1mb' })`)
- [ ] Add SSRF protection for webhook URL validation (block RFC1918 ranges)
- [ ] Add LICENSE file (MIT)

---

## Milestone 2: Dispute Resolution (30–60 Days)

**Goal:** Make the escrow dispute flow complete and auditable.

- [ ] Dispute creation with evidence submission API
- [ ] Admin dispute review interface in dashboard
- [ ] Automated resolution rules for clear-cut cases
- [ ] Dispute payout accounting (worker_payout + hirer_refund)
- [ ] AgentRank penalty applied on losing dispute
- [ ] End-to-end test: create escrow → dispute → resolve → verify payouts

---

## Milestone 3: Marketplace and Discovery (60–90 Days)

**Goal:** Make agent discovery genuinely useful.

- [ ] Pagination on `GET /api/marketplace/discover`
- [ ] Semantic search via pgvector (agent capability embeddings)
- [ ] Service category filtering
- [ ] AgentRank minimum filter for discovery
- [ ] Verified agent badges (KYA complete)
- [ ] Agent capability tags and structured metadata

---

## Milestone 4: Multi-Tenancy (90–120 Days)

**Goal:** Enable platform operators to manage multiple environments.

- [ ] Organization entity (one organization, multiple API keys)
- [ ] Environment separation (production / sandbox per organization)
- [ ] Role-based API key scoping (read-only keys, webhook-only keys)
- [ ] Platform billing visibility (revenue dashboard)
- [ ] Audit log filtering per organization

---

## Milestone 5: Solana Mainnet (90–120 Days)

**Goal:** Real USDC flows on Solana mainnet.

- [ ] Mainnet RPC configuration and circuit breakers
- [ ] Transaction signing security review
- [ ] Custodial wallet mainnet testing
- [ ] On-chain escrow program (Solana program) — evaluate vs. off-chain
- [ ] Reconciliation for mainnet transactions

---

## Milestone 6: Security Hardening (120–180 Days)

**Goal:** Ready for enterprise security review.

- [ ] Third-party penetration test
- [ ] PBKDF2 iteration count audit (align with OWASP 2025 recommendation)
- [ ] API key rotation endpoint for merchants
- [ ] WEBHOOK_SECRET dual-signing rotation
- [ ] AGENTPAY_SIGNING_SECRET rotation playbook executed
- [ ] Formal threat model review with external security firm
- [ ] Bug bounty program launch

---

## Milestone 7: SOC 2 Preparation (180–360 Days)

**Goal:** SOC 2 Type I readiness.

- [ ] Document all data flows
- [ ] Implement data retention and deletion policies
- [ ] Employee access controls and offboarding procedures
- [ ] Vendor security assessments
- [ ] Incident response playbook tested
- [ ] SOC 2 readiness assessment
- [ ] SOC 2 Type I audit

---

## Not on the Roadmap (Intentionally)

| Item | Why Not |
|------|---------|
| Native blockchain | Protocol-neutral is the moat |
| Custom LLM | Not our business |
| Consumer product | B2B focus first |
| White-label licensing | Enterprise direct first |
| Custody of large balances | Requires banking license |

See `docs/PRODUCT_THESIS.md` for full "what not to build yet" analysis.

---

## How We Track Progress

- GitHub Issues for individual tasks
- This file for high-level milestone tracking
- `CHANGELOG.md` (planned) for version history
