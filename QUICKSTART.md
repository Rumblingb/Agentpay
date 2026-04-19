# Quickstart

Three paths. Pick the one that matches where you are.

| Path | Time | Best for |
|------|------|---------|
| [MCP server](#path-a-mcp-server) | ~2 min | Claude Desktop, Cursor, any MCP host |
| [REST API](#path-b-rest-api) | ~5 min | Any language, direct HTTP calls |
| [Local dev](#path-c-local-development) | ~20 min | Contributing, self-hosting |

---

## Path A: MCP server

The fastest way to give an AI agent governed payment and capability access.

### 1. Register (30 seconds)

```bash
curl -s -X POST https://api.agentpay.so/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{ "name": "My Agent", "email": "you@example.com" }'
```

```json
{
  "success": true,
  "merchantId": "mer_...",
  "apiKey": "apk_..."
}
```

Save both values. The API key is shown once.

### 2. Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "agentpay": {
      "command": "npx",
      "args": ["-y", "@agentpayxyz/mcp-server"],
      "env": {
        "AGENTPAY_API_KEY": "apk_your_key_here",
        "AGENTPAY_MERCHANT_ID": "mer_your_merchant_id"
      }
    }
  }
}
```

Restart Claude Desktop.

### 3. Try it

Ask Claude any of these:

> "Create a governed mandate to book a train from London to Manchester, budget £100, require my approval above £50."

> "Connect Firecrawl without exposing the raw API key to the agent."

> "Create a $5 USDC payment request for a research task."

> "Look up the AgentPassport for agent_001 and show me its trust score."

Claude will call the AgentPay tools and return the result directly. No dashboard. No copy-pasting keys.

### Remote MCP (no local process)

If your host supports remote MCP:

```
https://api.agentpay.so/api/mcp
Authorization: Bearer apk_your_key_here
```

Or mint a short-lived token scoped to a specific host (OpenAI, Anthropic, etc.):

```bash
curl -X POST https://api.agentpay.so/api/mcp/tokens \
  -H "Authorization: Bearer apk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{ "audience": "openai", "ttlSeconds": 3600 }'
```

---

## Path B: REST API

### 1. Register

Same as above — one `curl`, get a `merchantId` and `apiKey`.

### 2. Create a governed mandate

A mandate is the core primitive: it captures what the agent is allowed to do, the budget, and the approval policy.

```bash
curl -s -X POST https://api.agentpay.so/api/mandates \
  -H "Authorization: Bearer apk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "mer_...",
    "objective": "Book a train from London Paddington to Bristol Temple Meads",
    "budgetCap": 50,
    "currency": "GBP",
    "approvalThreshold": 20,
    "agentId": "my-agent-01"
  }'
```

```json
{
  "success": true,
  "intentId": "mnd_...",
  "status": "pending_approval",
  "recommendation": "Cheapest direct service departs 07:04, £24.50"
}
```

### 3. Approve the mandate

```bash
curl -s -X POST https://api.agentpay.so/api/mandates/mnd_.../approve \
  -H "Authorization: Bearer apk_your_key_here"
```

### 4. Execute

```bash
curl -s -X POST https://api.agentpay.so/api/mandates/mnd_.../execute \
  -H "Authorization: Bearer apk_your_key_here"
```

AgentPay enforces the policy, runs the execution, and returns a verifiable receipt.

### 5. Get the receipt

```bash
curl -s https://api.agentpay.so/api/receipt/mnd_...
```

### Capability Vault (zero API key flow)

```bash
# Start a connect session — user gets an OTP link, not the raw key
curl -s -X POST https://api.agentpay.so/api/capabilities/connect-sessions \
  -H "Authorization: Bearer apk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "firecrawl",
    "merchantId": "mer_...",
    "agentId": "my-agent-01"
  }'
```

```json
{
  "sessionId": "cap_sess_...",
  "status": "auth_required",
  "connectUrl": "https://api.agentpay.so/connect/cap_sess_..."
}
```

User opens `connectUrl`, enters their Firecrawl key once. AgentPay vaults it. From this point, the agent calls `POST /api/capabilities/:capabilityId/execute` and AgentPay injects the credential on the way out.

### Payment intent (fiat or USDC)

```bash
curl -s -X POST https://api.agentpay.so/api/payments/funding-request \
  -H "Authorization: Bearer apk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "mer_...",
    "principalId": "user_001",
    "amount": 49,
    "currency": "GBP",
    "description": "Train booking — London to Bristol"
  }'
```

Returns a `nextAction` with a Stripe Checkout URL (card) or UPI deep-link, depending on currency.

---

## Path C: Local development

For contributing to the codebase or self-hosting the API.

### Prerequisites

- Node.js 20+
- Docker (for local Postgres)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) for the Workers API

### Steps

```bash
git clone https://github.com/Rumblingb/Agentpay.git
cd Agentpay
npm ci
cp .env.example .env
```

Edit `.env`. Required for the API to start:

```
DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=sk-ant-...
WEBHOOK_SECRET=<any 32-char string>
```

Everything else (Stripe, Razorpay, Darwin, IRCTC, ElevenLabs) is optional — the server starts without them and returns graceful errors for those specific routes.

```bash
# Start Workers API locally
cd apps/api-edge
npx wrangler dev

# Start the dashboard
cd dashboard
npm run dev
```

Workers API runs on `:8787`. Dashboard on `:3000`.

### Run the MCP server against local API

```bash
AGENTPAY_API_URL=http://localhost:8787 \
AGENTPAY_API_KEY=apk_dev_test \
npx -y @agentpayxyz/mcp-server
```

---

## Next steps

- [MCP server tool reference](packages/mcp-server/README.md) — all 30+ tools with parameters
- [API reference](openapi.yaml) — full OpenAPI 3.1 spec
- [Integration guide](INTEGRATION_GUIDE.md) — SDK, webhooks, framework adapters
- [Architecture](docs/architecture.md) — how the pieces fit together
- [Examples](examples/README.md) — runnable agents and framework integrations
