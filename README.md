# AgentPay

<p align="center">
  <strong>Autonomous agent infrastructure. One OTP. Zero API keys. Full autonomy within user-defined mandates.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@agentpayxyz/mcp-server"><img src="https://img.shields.io/npm/v/%40agentpayxyz%2Fmcp-server?color=4ade80&label=mcp-server" alt="npm"></a>
  <a href="https://github.com/Rumblingb/Agentpay/actions/workflows/ci.yml"><img src="https://github.com/Rumblingb/Agentpay/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/status-live_beta-4ade80" alt="Live Beta">
  <img src="https://img.shields.io/badge/license-BSL--1.1-blue" alt="License">
  <a href="https://github.com/Rumblingb/Agentpay"><img src="https://img.shields.io/github/stars/Rumblingb/Agentpay?style=social" alt="Stars"></a>
</p>

---

AgentPay is the layer that sits between an AI agent and the real world — APIs, payments, bookings — and handles trust, identity, and money so the developer does not have to.

It is not a payment processor. It is not a wallet. It is autonomous agent infrastructure.

```bash
npx -y @agentpayxyz/mcp-server
```

That one command gives any MCP-compatible AI assistant (Claude, GPT-4o, anything) the ability to create governed mandates, vault external API credentials, proxy third-party calls, and settle payments — without the developer touching a dashboard or the user pasting an API key.

---

## The three problems AgentPay solves

**1. Credential management**
Agents need API keys for Firecrawl, Perplexity, OpenAI, and dozens of other services. The current answer is: paste keys into `.env` files and hope. AgentPay's Capability Vault lets a user confirm a one-time OTP — AgentPay vaults the credential, and every future call proxies through AgentPay. The raw key never touches the agent again.

**2. Payment authorisation**
An agent that can spend money without constraint is a liability. AgentPay's mandate system lets users define exactly what an agent is allowed to do: the service, the budget ceiling, the approval threshold. The agent proposes. The human approves once. AgentPay enforces automatically from that point on.

**3. Identity and trust**
Agents need portable identity that travels across platforms, builds trust over time, and can be verified by any counterparty. AgentPassport is that record: a portable identity bundle with attestations, linked accounts, and a trust graph built from real settled outcomes.

---

## Get started in 30 seconds

Add AgentPay to Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "agentpay": {
      "command": "npx",
      "args": ["-y", "@agentpayxyz/mcp-server"],
      "env": {
        "AGENTPAY_API_KEY": "apk_your_key_here",
        "AGENTPAY_MERCHANT_ID": "your_merchant_id"
      }
    }
  }
}
```

Get your API key (no Solana wallet, no Stripe account needed to start):

```bash
curl -s -X POST https://api.agentpay.so/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{ "name": "My Agent", "email": "you@example.com" }'
```

Now ask Claude: *"Create a governed mandate to scrape this site via Firecrawl, budget $5, require my approval above $2."*

Claude calls `agentpay_create_mandate` → `agentpay_request_capability_connect`. You approve once. AgentPay handles the rest.

**[→ Full quickstart with REST API and local dev paths](QUICKSTART.md)**

---

## How it compares

| | AgentPay | Stripe Agentic | x402 | Nevermined |
|---|---|---|---|---|
| Card-first (not crypto-only) | ✅ | ✅ | ❌ USDC only | ❌ Web3 |
| First payment saves card → full autonomy | ✅ | ❌ | ❌ | ❌ |
| Capability Vault (API key proxy) | ✅ | ❌ | ❌ | ❌ |
| MCP server (Claude / OpenAI native) | ✅ | ❌ | ❌ | ❌ |
| Governed mandates with user-defined limits | ✅ | ❌ | ❌ | ❌ |
| Developer onboarding < 2 min | ✅ | ❌ | ❌ | ❌ |

---

## MCP tools

The MCP server exposes 30+ tools across four surfaces:

| Surface | Key tools |
|---------|-----------|
| **Mandates** | `agentpay_create_mandate`, `agentpay_approve_mandate`, `agentpay_execute_mandate`, `agentpay_get_mandate_history` |
| **Capability Vault** | `agentpay_request_capability_connect`, `agentpay_execute_capability`, `agentpay_list_capability_providers` |
| **Payments** | `agentpay_create_payment_intent`, `agentpay_create_human_funding_request`, `agentpay_list_funding_methods` |
| **Identity** | `agentpay_get_passport`, `agentpay_get_identity_bundle`, `agentpay_verify_identity_bundle` |

Full tool reference: [`packages/mcp-server/README.md`](packages/mcp-server/README.md)

---

## Remote MCP

For hosts that support remote MCP, connect directly — no local process required:

```
https://api.agentpay.so/api/mcp
```

Authenticate with your API key as a Bearer token, or mint a short-lived token:

```bash
curl -X POST https://api.agentpay.so/api/mcp/tokens \
  -H "Authorization: Bearer apk_your_key_here" \
  -d '{ "audience": "openai", "ttlSeconds": 3600 }'
```

---

## Ace — built on AgentPay

[Ace](apps/meridian/README.md) is a voice-first AI travel concierge that runs entirely on AgentPay infrastructure. Every booking Ace executes goes through a governed mandate, every payment settles through the AgentPay policy engine, and every agent identity is tracked on AgentPassport.

Ace is the live proof that the full stack works in production — UK rail and India rail are live today, with flights and hotels next.

**[→ Try Ace on TestFlight](https://testflight.apple.com/join/agentpay)**

---

## Repository layout

```
apps/
  api-edge/         Cloudflare Workers — public API (api.agentpay.so)
    src/routes/     concierge, mandates, capabilities, payments, identity
    src/cron/       platform watch, reconciliation, autonomy loop
  meridian/         React Native / Expo iOS app (Ace)

dashboard/          Next.js operator dashboard (app.agentpay.so)

packages/
  mcp-server/       @agentpayxyz/mcp-server — the published npm package
  sdk/              TypeScript SDK
  sdk-node/         Node.js SDK
  core/             Shared types and utilities

examples/
  agents/           Example agents (ResearchAgent, WebScraperAgent, …)
  adapters/         Framework adapters (LangGraph, CrewAI, AutoGPT, …)
  node-backend-agent/  Full Node.js backend agent example

docs/               Architecture, protocol specs, pitch decks
migrations/         PostgreSQL migrations
```

---

## Developer resources

| Resource | Link |
|----------|------|
| Quickstart (MCP + REST) | [QUICKSTART.md](QUICKSTART.md) |
| MCP server reference | [packages/mcp-server/README.md](packages/mcp-server/README.md) |
| Full API reference | [openapi.yaml](openapi.yaml) |
| Integration guide | [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) |
| Architecture | [docs/architecture.md](docs/architecture.md) |
| Examples | [examples/README.md](examples/README.md) |
| Security model | [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |

---

## Stack

```
API:        Cloudflare Workers (Hono) — edge-deployed, no cold starts
Database:   PostgreSQL via Supabase + Cloudflare Hyperdrive
AI:         Claude Sonnet 4.6 (concierge) · Haiku 4.5 (classify/extract)
Payments:   Stripe (fiat/card) · Razorpay (UPI) · Solana/USDC (on-chain)
Voice:      OpenAI Whisper (STT) · ElevenLabs (TTS)
```

---

## License

Business Source License 1.1 — converts to AGPL-3.0 on 2029-01-01.
Non-commercial use is free. Enterprise licences: [enterprise@agentpay.gg](mailto:enterprise@agentpay.gg)
