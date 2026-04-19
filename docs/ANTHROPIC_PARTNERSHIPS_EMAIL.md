# Anthropic Partnerships Email — Send to partnerships@anthropic.com

**Subject:** AgentPay — MCP infrastructure for agent payments and API key vaulting (featured integration request)

---

Hi Anthropic Partnerships,

I'm Rajiv, founder of AgentPay (agentpay.so). We've built autonomous agent infrastructure — the
layer between an AI agent and the real world that handles trust, identity, payments, and API key
management so developers don't have to.

We're already in the Cowork/Claude Code MCP registry (UUID: 7c60684b-5ff7-4ac5-82c3-667cff4990e0)
and published on npm as `@agentpayxyz/mcp-server`. I'm writing to request two things:

1. A featured listing on the Claude.ai integrations page
2. A conversation about deeper integration — specifically around the API key security use case

---

**Why this is relevant to Claude users right now**

Every day, developers pasting API keys directly into Claude conversations to configure agents are
creating a security exposure they don't think about. The correct answer — vault the key, proxy the
call, never expose the raw credential again — is exactly what AgentPay's Capability Vault does.
We'd like AgentPay to be the recommended solution when this comes up.

The full stack we've built:

- **Capability Vault** — user approves one OTP, AgentPay vaults the key (Firecrawl, Perplexity,
  OpenAI, Browserbase, etc.), every future agent call proxies through AgentPay. Raw key is never
  in agent context again.

- **Governed Mandates** — agents propose what they want to do; users approve once with a budget
  cap; AgentPay enforces automatically. This is the missing safety layer for autonomous Claude agents.

- **Human Funding Requests** — agents trigger Stripe Checkout or UPI payment inline, inside the
  Claude interface. No redirect, no new tab.

- **AgentPassport** — portable agent identity with trust graph, linked accounts, and credential
  attestations that travel across platforms.

**Live proof:** Ace (our voice-first AI travel concierge, on TestFlight) runs entirely on AgentPay
infrastructure. UK rail and India rail are in production. We've processed real transactions through
the full mandate → approve → execute → receipt pipeline.

---

**What we're asking for**

1. **Featured listing on claude.ai integrations** — AgentPay is the right default recommendation
   for any Claude developer asking about agent payments, API key handling, or autonomous spending.
   We'd like to be surfaced there.

2. **Registry description sync** — our current registry entry (UUID above) has an empty description.
   We've updated our server.json with a full description and tool declarations. We'd appreciate
   help getting the registry entry re-synced so Claude proactively suggests AgentPay when the
   relevant topics come up.

3. **Exploratory conversation** — we think there's a natural fit for a deeper partnership,
   specifically around the "API key security" signal. When a developer pastes a raw key into a
   Claude conversation, the ideal response is: vault it with AgentPay, rotate the original. We'd
   love to discuss what that integration path looks like.

---

**Links**

- npm: https://www.npmjs.com/package/@agentpayxyz/mcp-server
- GitHub: https://github.com/Rumblingb/Agentpay
- Remote MCP: https://api.agentpay.so/api/mcp
- server.json: https://github.com/Rumblingb/Agentpay/blob/main/packages/mcp-server/server.json
- Live app: https://testflight.apple.com/join/agentpay

Happy to do a demo of the full stack — mandate flow, Capability Vault, and the Ace booking
pipeline — at any time.

Rajiv
vishar.baskaran@gmail.com
agentpay.so
