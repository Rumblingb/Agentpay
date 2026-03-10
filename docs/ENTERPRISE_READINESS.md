# Enterprise Readiness — AgentPay

> **Version:** 1.0  
> **Last Updated:** 2026-03-10  
> **Status:** Early-stage. Honest assessment of current capabilities and gaps.

---

## What This Document Is

An honest, unvarnished assessment of what AgentPay can and cannot currently offer enterprise customers. We believe transparency about current capabilities builds more trust than inflated claims.

---

## Current Capabilities

| Capability | Status | Notes |
|------------|--------|-------|
| REST API | ✅ Operational | Full CRUD for agents, payments, escrow |
| API key authentication | ✅ Operational | PBKDF2-SHA256, per-key salt |
| Rate limiting | ✅ Operational | 100 req/15min global; configurable |
| Webhook delivery | ✅ Operational | HMAC-signed, retry with backoff |
| AgentRank trust scoring | ✅ Operational | 0–1000 score with behavioral signals |
| A2A escrow | ✅ Operational | Create/approve/dispute |
| Multi-protocol (x402, ACP, AP2) | ✅ Operational | Protocol adapter layer |
| Stripe fiat integration | ✅ Operational | Checkout, webhooks |
| Solana Pay | ✅ Devnet only | Mainnet not yet deployed |
| Structured logging | ✅ Operational | Pino JSON, requestId |
| Prometheus metrics | ✅ Operational | `/metrics` endpoint |
| RBAC | ✅ Operational | admin/platform/merchant/agent roles |
| Audit logging | ✅ Operational | `payment_audit_log` table |
| TypeScript SDK | ✅ Alpha | Core payment flows |
| Python SDK | ⚠️ Alpha | Payment intents only |
| Dashboard | ✅ Alpha | Metrics and agent management |
| OpenAPI spec | ✅ Present | May have some drift from implementation |

---

## What Is Not Production-Ready

| Gap | Impact | Timeline |
|-----|--------|----------|
| In-memory escrow (`trust-escrow.ts`) | Escrow state lost on restart | P0 — fix immediately |
| No SOC 2 | Required for enterprise security reviews | 6–12 months |
| No formal penetration test | Required for regulated customers | 3–6 months |
| Solana mainnet | Required for real USDC flows | 2–4 months |
| AP2 in-memory cache | AP2 intents lost on restart | 1–2 months |
| No multi-tenancy | Single organization model | 3–6 months |
| No billing visibility | Platforms can't see revenue | 2–3 months |
| Dispute resolution UI | Manual dispute flow only | 2–3 months |

---

## Security Controls

| Control | Status |
|---------|--------|
| TLS in transit | ✅ (Render load balancer) |
| PBKDF2 API keys | ✅ |
| AES-256-GCM wallet encryption | ✅ |
| Startup secret validation | ✅ |
| Helmet.js security headers | ✅ |
| CORS configuration | ✅ |
| Rate limiting | ✅ |
| RBAC | ✅ |
| Audit logging | ✅ |
| Secrets scanning in CI | ❌ Planned |
| Formal penetration test | ❌ Planned |
| SOC 2 Type I | ❌ Planned |
| Bug bounty program | ❌ Planned |

See `docs/SECURITY.md` for full details.

---

## Data and Compliance

| Requirement | Status |
|-------------|--------|
| Data stored in PostgreSQL | ✅ |
| Encryption at rest | ✅ (Render managed) |
| Audit log retention | ✅ (7 years planned) |
| GDPR data deletion | ❌ No self-service deletion flow |
| KYC/AML for fiat | ❌ Not implemented |
| PCI DSS | ❌ N/A (no card data stored; Stripe handles) |

---

## SLA (Current)

AgentPay does not currently offer formal SLA commitments. This section will be updated when the platform reaches production readiness for enterprise customers.

**Aspirational targets:**
- API availability: 99.9% monthly
- Support response (P1): 1 hour
- Support response (P2): 4 hours
- Support response (P3): 1 business day

---

## Integration Support

| Framework | Integration Status |
|-----------|------------------|
| LangGraph | Example available (no official SDK) |
| CrewAI | Example available (no official SDK) |
| AutoGPT | Example available (plugin pattern) |
| OpenAI | Example available (function calling) |
| Moltbook | Native integration |
| Custom agents | TypeScript/Python SDK |

---

## Contact

For enterprise inquiries or security disclosures:
- **Security:** security@agentpay.gg
- **Enterprise:** enterprise@agentpay.gg (planned)

---

## What We Are Actively Building

1. Persistent escrow (removing in-memory state)
2. Solana mainnet deployment
3. Multi-tenancy and organization management
4. Formal security audit
5. Dispute resolution workflow
6. SOC 2 preparation

We are honest about what is not built yet. The above gaps are features, not bugs, in our roadmap. If you are evaluating AgentPay for enterprise use and these gaps are blockers, please contact us — your feedback directly shapes our priorities.
