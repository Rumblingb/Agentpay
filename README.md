# AgentPay

<p align="center">
  <strong>Trust + capability vault + governed paid execution for agents.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@agentpayxyz/mcp-server"><img src="https://img.shields.io/npm/v/%40agentpayxyz%2Fmcp-server?color=4ade80&label=mcp-server" alt="npm"></a>
  <a href="https://github.com/Rumblingb/Agentpay/actions/workflows/ci.yml"><img src="https://github.com/Rumblingb/Agentpay/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/status-live_beta-4ade80" alt="Live Beta">
  <img src="https://img.shields.io/badge/license-BSL--1.1-blue" alt="License">
  <a href="https://github.com/Rumblingb/Agentpay"><img src="https://img.shields.io/github/stars/Rumblingb/Agentpay?style=social" alt="Stars"></a>
</p>

---

AgentPay is the authority layer between an AI agent and the real world.
It handles provider access, funding authority, human approval, exact-call resume, and proof so agents can finish work end to end without raw secrets in chat or repeated dashboard setup.

It is not a generic "agent platform."
It is the trust seam that makes autonomous execution usable.

```bash
npx -y @agentpayxyz/mcp-server
```

That one command gives any MCP-compatible host the ability to:

- request API access
- vault credentials without exposing the raw key to the agent
- run governed paid execution
- pause for OTP or approval only when needed
- resume the exact blocked call automatically
- reuse governed access later from the same workbench

---

## Why it exists

Agents fail at the same place every time:

1. they need an API the developer has not wired yet
2. they need a credential the human should not paste into chat
3. they hit a paid step and lose continuity

AgentPay fixes that seam.

**Capability Vault**
Users connect a provider once through AgentPay. The raw credential is vaulted server-side. The agent receives only governed capability access.

**Governed paid execution**
Humans set guardrails once: funding rail, auto-approve limit, OTP policy, and spend limits. AgentPay enforces those rules when the agent acts.

**Exact-call resume**
When a paid step needs a human, AgentPay pauses, collects the minimum approval, and resumes the exact blocked call without asking the agent to reconstruct it.

**Same-workbench reuse**
Local projects never need raw provider keys. AgentPay can issue opaque, revocable workbench leases so the same workbench can reuse governed access later.

## The inevitable path

This is the path AgentPay is built around:

1. Agent asks for an API.
2. AgentPay checks whether governed access already exists.
3. If not, AgentPay runs one hosted setup flow for authority and provider connection.
4. The agent uses the capability for free until paid usage is required.
5. AgentPay pauses for OTP or confirmation only if policy requires it.
6. AgentPay resumes the exact blocked call.
7. The same workbench can reuse governed access later without re-entering the secret.

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

Get your API key:

```bash
curl -s -X POST https://api.agentpay.so/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{ "name": "My Agent", "email": "you@example.com" }'
```

Now ask your host:

> "My agent needs Firecrawl. Set a $5 auto-approve limit, ask for OTP above that, and keep the key out of chat."

Or:

> "My agent needs Databento for this workbench. If access already exists, reuse it. If not, start the minimal AgentPay setup flow."

**[Full quickstart](./QUICKSTART.md)**

---

## Terminal-native control plane

AgentPay should be operated through hosts and terminals, not a merchant dashboard.

Key surfaces:

- `GET /api/capabilities/authority-bootstrap`
- `POST /api/capabilities/authority-bootstrap`
- `POST /api/capabilities/access-resolve`
- `POST /api/capabilities/onboarding-sessions`
- `POST /api/capabilities/lease-execute`
- `GET /api/capabilities/leases`
- `POST /api/capabilities/leases/:leaseId/revoke`
- `POST /api/capabilities/:capabilityId/execute`

These let a host or agent:

- read authority state
- set guardrails
- connect providers
- request human approval only when needed
- reuse governed access safely later

## Flagship provider paths

The current wedge is strongest when AgentPay owns setup and continuity for high-value agent APIs.

Current priority paths:

- Databento
- Firecrawl
- Browserbase
- Exa
- Generic REST API fallback

The product goal is simple: visiting provider dashboards should become the exception, not the default.

## Remote MCP

For hosts that support remote MCP:

```
https://api.agentpay.so/api/mcp
```

Authenticate with your API key as a Bearer token, or mint a short-lived token for Claude, OpenAI, or another remote MCP host:

```bash
curl -X POST https://api.agentpay.so/api/mcp/tokens \
  -H "Authorization: Bearer apk_your_key_here" \
  -d '{ "audience": "openai", "ttlSeconds": 3600 }'
```

## Ace - built on AgentPay

[Ace](apps/meridian/README.md) is a proof front door built on AgentPay.
It demonstrates the core seam under real-world conditions. It is not the core story.

## Product truth

If a human still has to:

- paste a raw provider key into chat
- rebuild a blocked call after payment
- keep reopening provider dashboards
- or lose continuity between approval and execution

then the product is still unfinished.

## Developer resources

| Resource | Link |
|----------|------|
| Quickstart | [QUICKSTART.md](./QUICKSTART.md) |
| MCP server reference | [packages/mcp-server/README.md](./packages/mcp-server/README.md) |
| Full API reference | [openapi.yaml](./openapi.yaml) |
| Terminal-native control plane | [docs/TERMINAL_NATIVE_CONTROL_PLANE_20260419.md](./docs/TERMINAL_NATIVE_CONTROL_PLANE_20260419.md) |
| Examples | [examples/README.md](./examples/README.md) |
| Security model | [docs/SECURITY_MODEL.md](./docs/SECURITY_MODEL.md) |

## Repository layout

```
apps/
  api-edge/         Cloudflare Workers public API
  meridian/         Ace front door

packages/
  mcp-server/       Published MCP package
  sdk/              TypeScript SDK
  sdk-node/         Node.js SDK

examples/           Example agents and adapters
docs/               Architecture and product notes
migrations/         PostgreSQL migrations
ops/                Founder and growth operating artifacts
```

## License

Business Source License 1.1. Converts to AGPL-3.0 on 2029-01-01.
