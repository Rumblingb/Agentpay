# AgentPay — One Pager

**The identity, trust, and coordination layer for autonomous agent commerce.**

---

## The Problem

AI agents are increasingly hired to perform real work — research, data
processing, code execution, content generation — and paid in cryptocurrency or
fiat. The infrastructure for that is immature: there is no standard trust layer,
no escrow primitive, and no way to score an agent's reliability before you send
funds.

When an agent hires another agent, how do you know the counterparty will
deliver? How does the payer confirm work was done before releasing funds? How
does the payee know the payment isn't fraudulent?

Stripe, Solana, and Visa provide payment rails. **AgentPay provides the trust
and financial operating system primitives** that sit on top of those rails.

---

## The Solution

AgentPay is the FICO score + escrow + identity layer for the agentic economy.

### Core Primitives

| Primitive | What it does |
|-----------|-------------|
| **AgentRank** | 0–1000 trust score per agent (payment reliability, delivery history, wallet age, dispute rate) |
| **A2A Escrow** | Lock funds → mark complete → approve/dispute — persisted to PostgreSQL |
| **KYA Gateway** | Link agents to verified humans via email, Stripe, platform tokens |
| **Behavioral Oracle** | Real-time fraud detection (wash trading, predatory disputes, looping transactions) |
| **Sybil Resistance** | Wallet-age, stake, and social-graph signals block fake agents |
| **Programmatic Disputes** | Automated scoring + peer review — no human arbiter needed |

---

## Multi-Protocol: Works Everywhere

| Protocol | Status |
|----------|--------|
| x402 (HTTP 402 Paywall) | ✅ Live |
| ACP (Agent Communication Protocol) | ✅ Live |
| AP2 (Agent Payment Protocol v2) | ✅ Live |
| Solana Pay + USDC | ✅ Devnet |
| Stripe Connect + fiat | ✅ Live |

---

## Integrations (Ready Today)

| Platform | Integration time |
|----------|-----------------|
| CrewAI | < 5 minutes (drop-in tool) |
| LangGraph | < 5 minutes (state node) |
| OpenAI Agents SDK | < 5 minutes (function tools) |
| Any HTTP client | < 1 minute (REST API) |

---

## Revenue Model

AgentPay's commercial model compounds across five layers:

| Layer | Description |
|-------|-------------|
| **Identity Verification Fees** | KYA is the entry gate into trusted participation. Priced per verification event. |
| **Reputation Oracle Queries** | Trust graph lookups and counterparty risk signals. Priced per query. |
| **Intent Coordination Fees** | Routing and orchestration across Solana, Stripe, and hybrid flows. Per-transaction fee. |
| **Dispute Arbitration** | Structured resolution flow with evidence review and trust consequences. Scaled to transaction size. |
| **Enterprise API Licensing** | High-throughput access, embedded trust graph infrastructure, custom integrations. |

These layers are sequential, not parallel: identity enables reputation, reputation enables coordination, coordination enables enforcement, enforcement enables enterprise trust.

---

## Traction

- **852 tests passing across 62 suites** — unit, integration, security, e2e
- **Deployed**: Render.com (API), Vercel (dashboard)
- **SDKs**: TypeScript (`@agentpay/sdk`) + Python (`agentpay`), npm/PyPI publish-ready
- **CLI**: `agentpay-cli` npm package for agent deployment
- **Docs**: OpenAPI 3.1 spec, Swagger UI, onboarding guides
- **Production-hardened**: PBKDF2 API keys, AES-256-GCM wallet encryption, rate limiting, Helmet.js, RBAC, audit logging

---

## Competitive Positioning

| | AgentPay | Stripe | Solana Pay | Payman |
|---|---------|--------|------------|--------|
| A2A trust scoring | ✅ | ❌ | ❌ | ❌ |
| Escrow + disputes | ✅ | ❌ | ❌ | Partial |
| Multi-protocol | ✅ | ❌ | ❌ | ❌ |
| Sybil resistance | ✅ | ❌ | ❌ | ❌ |
| Agent-native DX | ✅ | ❌ | ❌ | Partial |
| Fiat on-ramp | ✅ | ✅ | ❌ | ✅ |

AgentPay is **complementary to Payman** — they handle traditional payroll/fiat
flows; AgentPay handles crypto-native A2A trust and escrow.

---

## Status

**Public Beta.** Core payment and escrow flows work end-to-end. Cloudflare Workers API is the primary production surface; Solana is on devnet pending mainnet readiness. Some endpoints return 501 during ongoing Workers migration. AgentRank and escrow analytics are partially implemented. See [docs/ENTERPRISE_READINESS.md](docs/ENTERPRISE_READINESS.md) for a full honest assessment.

---

## Contact

- **GitHub**: [github.com/Rumblingb/Agentpay](https://github.com/Rumblingb/Agentpay)
- **Issues**: [github.com/Rumblingb/Agentpay/issues](https://github.com/Rumblingb/Agentpay/issues)
- **Security**: security@agentpay.gg
- **License**: [MIT](https://opensource.org/licenses/MIT)
