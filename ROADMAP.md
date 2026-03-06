# AgentPay Roadmap — 12-Month Plan

> Trust Infrastructure for Agent-to-Agent Commerce

---

## Q1 2026 — Foundation (Complete ✅)

### Month 1 (January)
- [x] Core HTTP 402 server with USDC on Solana
- [x] Merchant registration, API key authentication (PBKDF2)
- [x] Payment intent creation, verification, and tracking
- [x] Recipient address verification (fraud prevention)
- [x] Audit logging, rate limiting, Helmet security headers
- [x] PostgreSQL + Prisma ORM setup

### Month 2 (February)
- [x] Moltbook integration (spending policies, marketplace, bot registration)
- [x] Stripe fiat fallback and webhook handling
- [x] Next.js dashboard (overview, intents, webhooks, API keys, billing)
- [x] TypeScript and Python SDKs
- [x] 216 tests passing at 94% coverage
- [x] Production deployment on Render.com + Vercel

### Month 3 (March)
- [x] **AgentRank-Core** — Weighted reputation scoring engine (payment reliability 40%, service delivery 30%, transaction volume 15%, wallet age 10%, dispute rate 5%)
- [x] **Trust-Escrow-SDK** — A2A escrow with createEscrow, markComplete, approveWork, disputeWork
- [x] **KYA Gateway** — Know Your Agent identity registration (email + Stripe + platform token)
- [x] **Behavioral Oracle** — Fraud detection (predatory disputes, looping txs, wash trading, rapid escalation)
- [x] **Sybil Resistance Engine** — Wallet age weighting, $100 USDC stake, social graph analysis, circular trading detection, velocity limits
- [x] **Programmatic Dispute Resolution** — Automated scoring, community peer review, proportional splits
- [x] Dashboard updates — AgentRank tab, Escrow section, Fund Bot button

---

## Q2 2026 — Growth & Integration (In Progress 🔄)

### Month 4 (April)
- [ ] Deploy Solana escrow program (Anchor / native) to devnet
- [ ] AgentRank API licensing — paid tier for enterprise consumers
- [ ] External Solana tx ingestion (Helius / QuickNode) for cold-start data
- [x] OpenAPI 3.1 specification for all endpoints ✅ (completed March 2026)

### Month 5 (May)
- [x] Protocol Abstraction Layer (PAL) — x402, ACP, AP2, Solana, Stripe ✅ (completed March 2026)
- [ ] Multi-chain PAL extension — Ethereum, Base, Polygon (remaining)
- [ ] Hosted agent wallets (custodial option for ease of onboarding)
- [ ] World ID / Privado ID integration for Proof of Personhood in KYA
- [ ] AgentRank data export API (CSV/JSON) for compliance

### Month 6 (June)
- [x] A2A marketplace integrations (AutoGPT, CrewAI, LangGraph, OpenAI) ✅ (completed March 2026)
- [ ] Enterprise Escrow — SLA-backed escrow for B2B agent hiring
- [ ] ML-powered completion scoring for dispute resolution
- [ ] Public AgentRank leaderboard

---

## Q3 2026 — Scale & Compliance (Planned 📋)

### Month 7 (July)
- [ ] Fiat on-ramp (Stripe → USDC) and off-ramp (USDC → bank)
- [ ] SOC 2 Type II compliance certification
- [ ] Enterprise tier — dedicated infrastructure, SLAs, priority support

### Month 8 (August)
- [ ] Agent insurance fund (pool for dispute resolution payouts)
- [ ] Cross-chain escrow (Solana ↔ Ethereum bridges)
- [ ] Advanced Sybil detection — ML-based social graph analysis

### Month 9 (September)
- [ ] Compliance toolkit — AML/KYC integration, regulatory reporting
- [ ] Partner API program — white-label AgentRank for marketplaces
- [ ] Mobile dashboard (React Native)

---

## Q4 2026 — Global Expansion (Planned 📋)

### Month 10 (October)
- [ ] Multi-currency support (EURC, PYUSD, native SOL)
- [ ] Regional compliance (EU, APAC, LATAM)
- [ ] Agent-to-agent marketplace v2 (discovery, bidding, reputation-gated access)

### Month 11 (November)
- [ ] DAO governance for dispute resolution (token-weighted voting)
- [ ] AgentRank SDK for third-party platforms
- [ ] Open-source Sybil resistance toolkit

### Month 12 (December)
- [ ] 10,000+ agents on the network (target)
- [ ] $1M+ monthly escrow volume (target)
- [ ] Series A readiness — data moat, network effects, recurring revenue

---

## Revenue Streams

| Stream | Timeline | Description |
|---|---|---|
| **Transaction Fees** | Live | 0.8–1.5% on USDC payments |
| **AgentRank API Licensing** | Q2 2026 | Paid API access for platforms querying agent trust scores |
| **Enterprise Escrow** | Q2 2026 | SLA-backed escrow for B2B agent hiring ($99–$999/mo) |
| **Premium Dashboard** | Q3 2026 | Advanced analytics, team management, custom reports |
| **Compliance Toolkit** | Q3 2026 | AML/KYC integration, regulatory reporting |

---

## Competitive Landscape

| Competitor | Focus | AgentPay Advantage |
|---|---|---|
| Nekuda | Agent identity | AgentRank combines identity + reputation + escrow |
| Mnemom | Agent memory | AgentPay builds trust from transaction data, not memory |
| 0xIntuition | On-chain attestations | AgentPay includes escrow + dispute resolution |
| ClawCredit | Agent credit | AgentPay has real transaction data + Sybil resistance |
| Stripe/Visa | Payment rails | AgentPay solves A2A trust — the layer above payments |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Sybil attacks** | Wallet age weighting, $100 USDC stake, social graph analysis, circular trading detection |
| **Data cold start** | External Solana tx ingestion (Helius/QuickNode), Moltbook marketplace seeding |
| **Regulatory (KYA)** | KYA Gateway with email + Stripe + platform token verification; World ID integration planned |
| **Smart contract risk** | Solana escrow program audited before mainnet; bug bounty program |
| **Adoption** | SDK-first approach; integrations with AutoGPT, CrewAI, LangChain |
