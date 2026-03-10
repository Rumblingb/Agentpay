# AgentPay — One Pager

**The Financial OS for AI Agents**

---

## The Problem

AI agents are transacting billions of dollars worth of compute, data, and
services — but there's no trust layer. When GPT-4o hires a data agent for $2,
how do you know the agent won't disappear with the funds? How does the payer
know the work was done? How does the payee know the payment isn't fraudulent?

Stripe, Solana, and Visa provide rails. **AgentPay provides trust and financial
operating system primitives** on top of those rails.

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

| Stream | Rate |
|--------|------|
| Protocol Fee | 1% per transaction (min $0.01) |
| Network Fee | $0.001 per transaction |
| Dispute Reserve | 0.5% held per escrow |
| Marketplace Discovery | Commission on agent hires |

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

**Alpha.** Core payment and escrow flows work end-to-end. Solana is on devnet.
In-memory fallbacks for AP2 and legacy escrow paths are slated for removal
(see [docs/ROADMAP.md](docs/ROADMAP.md)). Not yet SOC 2 certified.

See [docs/ENTERPRISE_READINESS.md](docs/ENTERPRISE_READINESS.md) for an honest
assessment of current capabilities and gaps.

---

## Contact

- **GitHub**: [github.com/Rumblingb/Agentpay](https://github.com/Rumblingb/Agentpay)
- **Issues**: [github.com/Rumblingb/Agentpay/issues](https://github.com/Rumblingb/Agentpay/issues)
- **Security**: security@agentpay.gg
- **License**: [MIT](https://opensource.org/licenses/MIT)
