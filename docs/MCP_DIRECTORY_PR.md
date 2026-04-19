# MCP Directory Submission — Instructions

This file contains everything needed to submit AgentPay to the official MCP server directory at
https://github.com/modelcontextprotocol/servers

The directory is what powers the "integrations" and "add tools" discovery flow in Claude.ai and Claude Code.

---

## Steps to submit

1. Fork https://github.com/modelcontextprotocol/servers
2. Add the entry below to the servers list (usually `README.md` or `servers.json` depending on
   the current directory format — check the repo structure at submission time)
3. Open a PR with the title: `Add AgentPay — MCP server for agent payments and API key vaulting`
4. Use the PR description below

---

## Directory entry (add to the servers list)

```markdown
### [AgentPay](https://github.com/Rumblingb/Agentpay/tree/main/packages/mcp-server)

Autonomous agent infrastructure — payments, API key vaulting, and governed mandates for AI agents.

- **Install:** `npx -y @agentpayxyz/mcp-server`
- **Remote MCP:** `https://api.agentpay.so/api/mcp`
- **Category:** Payments / Infrastructure
- **Auth:** API key (`AGENTPAY_API_KEY`)

**What it does:**
Lets agents create governed mandates (user-approved spending limits), vault external API credentials
via a one-time OTP so agents never handle raw keys, proxy calls to Firecrawl, Perplexity, OpenAI,
and others through a secure capability layer, and settle payments via Stripe (card/GBP) or
Razorpay/UPI (INR). Works with Claude Desktop, Claude Code, GPT-4o, and any MCP-compatible host.

**Key tools:** `agentpay_create_mandate`, `agentpay_request_capability_connect`,
`agentpay_execute_capability`, `agentpay_create_human_funding_request`, `agentpay_get_passport`
```

---

## PR description (paste into GitHub PR body)

```
## Add AgentPay — payments, API key vaulting, and governed mandates for AI agents

**Package:** `@agentpayxyz/mcp-server` (npm)
**Remote MCP:** `https://api.agentpay.so/api/mcp`
**server.json:** https://github.com/Rumblingb/Agentpay/blob/main/packages/mcp-server/server.json
**Docs:** https://github.com/Rumblingb/Agentpay/tree/main/packages/mcp-server

### What this server does

AgentPay is autonomous agent infrastructure — the layer between an AI agent and the real world
(APIs, payments, bookings) that handles trust, identity, and money so the developer doesn't have to.

The MCP server exposes three core capabilities:

**1. Capability Vault**
Developers building agents face a hard problem: their agents need API keys (Firecrawl, Perplexity,
OpenAI, etc.) but raw keys in agent context are a security risk. AgentPay solves this with a
one-time OTP flow — the user approves once, AgentPay vaults the credential, and every future
call proxies through AgentPay. The agent never sees the raw key.

Tool: `agentpay_request_capability_connect`, `agentpay_execute_capability`

**2. Governed Mandates**
Agents that can spend money need spending limits. The mandate system lets users define
exactly what an agent is authorised to do: objective, budget cap, currency, approval threshold.
The agent proposes. The human approves once. AgentPay enforces automatically.

Tools: `agentpay_create_mandate`, `agentpay_approve_mandate`, `agentpay_execute_mandate`

**3. Human Funding Requests**
Agents can trigger a Stripe Checkout or UPI payment request inline — the user pays without
leaving the chat interface.

Tool: `agentpay_create_human_funding_request`

### Live proof

Ace (https://testflight.apple.com/join/agentpay) is a voice-first AI travel concierge built
entirely on AgentPay infrastructure. UK rail and India rail are live in production today.

### Checklist
- [x] server.json follows the MCP schema
- [x] npm package published and installable via npx
- [x] Remote MCP endpoint live at api.agentpay.so/api/mcp
- [x] Auth documented (AGENTPAY_API_KEY)
- [x] Tools documented in package README
```

---

## Category tags to use (if the directory uses tags)

`payments`, `infrastructure`, `api-management`, `credentials`, `identity`, `mandates`,
`agent-billing`, `firecrawl`, `stripe`, `upi`, `claude`, `openai`
