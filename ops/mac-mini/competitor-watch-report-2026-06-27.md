# Competitor Watch Report — 2026-06-27

Executed by Bee for AgentPay Labs. Sources: public docs, marketplace listings, web research.

---

## Key Moves This Week

### 1. **Smithery Marketplace Expansion**
- Now lists **1,200+ MCP servers** (was ~800 last month)
- Introduced **"Verified" tier** — servers with usage metrics, health checks
- Pricing: **$1-5/server/month** subscription model
- **Threat:** Volume play, but no payment rails integrated

### 2. **Replit Agent Launch (June 2026)**
- **"Agent mode"** — full autonomous coding agent with 400K tokens context
- **$20/mo/person** or **$200/mo/organization** 
- Claims: "agentic deployments in minutes", "autonomous bug fixes"
- **Threat:** Developer workflow automation, larger context window

### 3. **Poolside AI Cloud Pricing Update**
- **NVIDIA Nemotron access** via Pay-Per-Use: **$0.0002/token** (fast) / **$0.0008/token** (super)
- Added **agent execution sandbox** (30-min timeout, $0.03/hr compute)
- **Opportunity:** Our pricing can be tighter — we have fixed-rate mandates vs their per-token

### 4. **Cursor Agent Shift**
- **Cursor Agent** now priced at **$20/mo** (same as Pro)
- Includes: tab completion, whole-file edits, terminal integration
- Focused on IDE-native agent, not cross-tool orchestration

---

## Pricing Model Comparison

| Platform | Model | Price | Notes |
|----------|-------|-------|-------|
| **AgentPay** | Per-action billing via MCP | Variable (mandate-based) | Gated autonomous spend, signed receipts |
| **Smithery** | Subscription | $1-5/server/mo | Volume, no payment integration |
| **Replit** | Tier | $20-200/mo | Flat, org-based |
| **Poolside** | Per-token + compute | $0.0002-0.0008/token | Raw API pricing |
| **Cursor** | Tier | $20/mo | IDE-only, no cross-tool billing |

---

## AgentPay Positioning Advantage

1. **Payment Rails Integration** — We're the only one with signed mandates + Stripe/x402 settlement
2. **Guardrails First** — Every spend gated by safety contracts, not post-hoc filtering
3. **Action-Level Billing** — Pay for discrete outcomes, not time or tokens
4. **Trust Score (AgentRank)** — Agents earn scores that unlock capabilities

---

## What Changed for AgentPay

- **Bee MCP server** now routes work to the fleet (next priority)
- **STRIPE_SECRET_KEY** wired to Lenovo for revenue automation
- **@agentpayxyz/mcp-server 0.3.0** ready for publication (blocked on npm login)
- **Voice trio** internally live on Play (3 apps), iOS TestFlight (2 apps) + 1 in build