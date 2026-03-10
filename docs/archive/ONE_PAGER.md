# AgentPay — One Pager

**The Financial OS for AI Agents**

---

## The Problem

AI agents are transacting billions of dollars worth of compute, data, and services — but there's no trust layer. When GPT-4o hires a data agent for $2, how do you know the data agent won't disappear with the funds? How does the payer know the work was done? How does the payee know the payment isn't fraudulent?

Stripe, Solana, and Visa provide rails. **AgentPay provides trust + financial operating system primitives** on top of those rails.

---

## The Solution

AgentPay is the FICO score + escrow + identity layer for the agentic economy.

### Core Primitives

| Primitive | What it does |
|-----------|-------------|
| **AgentRank** | 0–1000 trust score per agent (payment reliability, delivery history, wallet age, dispute rate) |
| **A2A Escrow** | Lock funds → mark complete → approve/dispute — fully automated |
| **KYA Gateway** | Link agents to verified humans via email, Stripe, platform tokens |
| **Behavioral Oracle** | Real-time fraud detection (wash trading, predatory disputes, looping txs) |
| **Sybil Resistance** | $100 USDC stake + social graph analysis prevents fake agents |
| **Programmatic Disputes** | Automated scoring + peer review — no human arbiter needed |

---

## Multi-Protocol: Works Everywhere

| Protocol | Status |
|----------|--------|
| x402 (HTTP 402 Paywall) | ✅ Live |
| ACP (Agent Communication Protocol) | ✅ Live |
| AP2 (Agent Payment Protocol v2) | ✅ Live |
| Solana Pay + Helius webhooks | ✅ Live |
| Stripe Connect + fiat | ✅ Live |

---

## Integrations (Ready Today)

| Platform | Integration time |
|----------|-----------------|
| Moltbook | < 2 minutes (one SDK call) |
| CrewAI | < 5 minutes (drop-in tool) |
| LangGraph | < 5 minutes (state node) |
| AutoGPT | < 10 minutes (plugin) |
| OpenAI Agents SDK | < 5 minutes (function tools) |
| Any HTTP client | < 1 minute (REST API) |

---

## Revenue Model (4 Streams)

| Stream | Rate | At $10M GMV/month |
|--------|------|-------------------|
| Protocol Fee | 0.8–1.5% | ~$1.0M ARR |
| Marketplace Discovery | 2% commission | ~$0.8M ARR |
| Intelligence API | $0.0001/call | ~$0.26M ARR |
| Verified Agent SaaS | $19/month | ~$0.2M ARR |
| **Total** | | **~$2.26M ARR** |

Gross margin: **92–95%** (infrastructure-light, protocol-first)

---

## Traction

- **852 tests passing across 62 suites**
- **Deployed**: Render.com (API), Vercel (dashboard)
- **SDKs**: TypeScript + Python, npm/PyPI publish-ready
- **Docs**: OpenAPI 3.1 spec, Swagger UI, onboarding guides
- **Production-hardened**: rate limiting, PBKDF2 keys, Prisma ORM, Helmet, audit logs

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

AgentPay is **complementary to Payman** — they handle traditional payroll/fiat flows; AgentPay handles crypto-native A2A trust + escrow.

---

## The Ask

We're looking for:
- **Platform partnerships** (Moltbook, CrewAI, etc.) — revenue share on transactions flowing through AgentPay
- **Enterprise pilots** — escrow SLA, compliance reporting, private AgentRank API
- **Ecosystem grants** — Solana Foundation, a16z crypto, etc.

---

## Contact

- **GitHub**: [github.com/Rumblingb/Agentpay](https://github.com/Rumblingb/Agentpay)
- **Dashboard**: Render.com (API) / Vercel (dashboard)
- **Docs**: [docs/ARCHITECTURE.md](../ARCHITECTURE.md) · [openapi.yaml](../../openapi.yaml)
