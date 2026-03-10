# Product Thesis — AgentPay

> **Version:** 1.0  
> **Last Updated:** 2026-03-10  
> **Status:** Internal working document

---

## Core Wedge

**AgentPay's wedge is structured, verifiable payment between AI agents.**

As AI agents increasingly perform real work on behalf of humans and organizations — booking, researching, coding, transacting — they need a way to pay each other for services, verify trustworthiness before committing funds, and resolve disputes when work is incomplete or fraudulent.

Existing payment rails (Stripe, Solana, bank transfers) were not designed for agent-to-agent (A2A) transactions:
- No trust or reputation layer
- No structured dispute resolution
- No agent identity verification
- No composable contract primitives

AgentPay fills this gap with:
1. **Identity** — verified agent registration (KYA)
2. **Trust** — AgentRank score (0–1000) derived from behavioral signals
3. **Escrow** — structured lock/release with dispute handling
4. **Settlement** — multi-protocol payment execution (Solana, Stripe)
5. **Marketplace** — discovery of trusted agents by capability and score

---

## Ideal Customer Profiles (ICPs)

### ICP 1: AI Application Developer
- Building multi-agent workflows (LangGraph, CrewAI, AutoGPT, custom)
- Needs: reliable payment rail between agents, no custom billing logic
- Entry point: TypeScript/Python SDK, 5-minute quickstart

### ICP 2: AI Agent Marketplace Operator
- Running a marketplace where agent developers publish and monetize agent services
- Needs: escrow, reputation, dispute resolution, revenue visibility
- Entry point: Platform API, webhook events, RBAC

### ICP 3: Enterprise AI Platform
- Deploying internal or external agent ecosystems at scale
- Needs: multi-tenancy, audit logs, compliance, SLAs
- Entry point: Enterprise onboarding, dedicated support, SOC 2 path

---

## Primary Use Cases

### 1. Agent Hiring and Job Settlement (Core Wedge)
Agent A hires Agent B for a specific task, funds escrow, Agent B completes work, funds are released after verification.

### 2. Multi-Agent Workflow Billing
A workflow orchestrator needs to charge sub-agents for compute, API calls, or specialized services without manual accounting.

### 3. Trust-Gated Agent Access
A marketplace requires agents to have a minimum AgentRank score before they can be hired, reducing fraud and poor-quality work.

### 4. Dispute Resolution
When Agent B fails to complete work or Agent A wrongly withholds payment, AgentPay provides a structured arbitration flow.

### 5. Reputation Building
New agents bootstrap trust by completing small, low-risk jobs and accumulating positive signal toward higher AgentRank scores.

---

## Why Now

1. **AI agents are executing real work** — not just generating text. They're booking flights, writing code, executing transactions, managing files.

2. **Multi-agent workflows are becoming standard** — LangGraph, CrewAI, AutoGPT, and custom orchestrators all need a way for agents to pay each other.

3. **Existing payment rails are not agent-native** — Stripe, Solana, and bank payments require human-readable invoices, KYC, and manual reconciliation. None of these fit agent-to-agent flows.

4. **Trust is the bottleneck** — agents need a verifiable reputation system before any enterprise will let them autonomously commit funds. AgentRank addresses this gap.

5. **First-mover in protocol layer** — x402, ACP, AP2 are nascent standards. Owning the multi-protocol abstraction layer now creates switching costs later.

---

## Moat Strategy

| Moat | Description | Timeline |
|------|-------------|----------|
| **Data moat** | AgentRank scores improve as more transactions flow through the platform; historical behavioral data is unique and non-replicable | Medium-term |
| **Network effects** | Agents with high AgentRank attract more hirers; hirers trust the platform more as agent quality improves | Medium-term |
| **Protocol lock-in** | As x402, ACP, AP2 standardize, AgentPay's multi-protocol layer becomes the reference implementation | Long-term |
| **Integration ecosystem** | SDK integrations with major frameworks (LangGraph, CrewAI, etc.) create distribution moats | Short-term |
| **Compliance** | SOC 2, AML, and KYA/KYC certification creates a barrier for self-built alternatives in enterprise | Long-term |

---

## Network Effects

1. **More agents → better discovery** — a larger marketplace gives hirers more options, increasing platform value
2. **More transactions → better AgentRank** — more behavioral data improves score accuracy, reducing fraud
3. **Better scores → higher-value transactions** — trusted agents can command higher prices and take on larger escrow amounts
4. **More integrations → lower agent onboarding cost** — framework integrations reduce time-to-first-payment

---

## Defensibility

- **Proprietary behavioral dataset** — every transaction, dispute, and reputation event creates training data for risk models
- **Protocol neutrality** — multi-protocol support means AgentPay is not tied to any one chain or standard
- **Trust graph** — agent-to-agent endorsements and transaction histories form a graph that is expensive to replicate
- **Compliance** — regulated financial infrastructure is hard to clone quickly

---

## What Not to Build Yet

| Feature | Why Not Yet |
|---------|------------|
| Native LLM inference | Not our business; use existing providers |
| Custom blockchain | Protocol-neutral is the moat; owning a chain would fragment the market |
| Full KYC/AML platform | Integrate with existing providers (Persona, Stripe Identity) |
| Agent execution environment | Execution is someone else's problem; we own the payment and trust layer |
| Consumer-facing product | B2B developer/enterprise focus first |
| Custody of large balances | Start with small-escrow flows; large custody requires banking licenses |
| AI model marketplace | Too broad; focus on payment and trust, not model distribution |

---

## Metrics That Define Success

| Metric | Current | 6-Month Target |
|--------|---------|---------------|
| Active agents (paid ≥1 tx) | — | 500 |
| Escrow volume (USD) | — | $500K |
| Dispute rate | — | <3% |
| Successful escrow completion rate | — | >95% |
| AgentRank accuracy (dispute prediction) | — | Establish baseline |
| SDK integrations (active installs) | — | 1,000 |
