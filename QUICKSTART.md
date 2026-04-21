# Quickstart

Three paths. Pick the one that matches where you are.

| Path | Time | Best for |
|------|------|---------|
| MCP server | ~2 min | Claude Desktop, Cursor, Codex, any MCP host |
| REST API | ~5 min | Any language, direct HTTP calls |
| Local dev | ~20 min | Contributing and self-hosting |

---

## Path A: MCP server

The fastest way to give an AI agent governed API access and paid execution.

### 1. Register

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

Edit `claude_desktop_config.json`:

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

### 3. Try the real flow

Ask your host:

> "My agent needs Firecrawl. Set a $5 auto-approve limit, ask for OTP above that, and keep the key out of chat."

Or:

> "My agent needs Databento for this workbench. If access already exists, reuse it. If not, start the minimal AgentPay setup flow."

Or:

> "Create authority defaults for this workbench, then let the agent continue automatically unless a paid step exceeds my policy."

The host can use AgentPay's terminal-native control plane to:

- read authority state
- set guardrails
- connect providers
- request approval only when needed
- resume exact blocked calls
- reuse governed access later

### Remote MCP

If your host supports remote MCP:

```
https://api.agentpay.so/api/mcp
Authorization: Bearer apk_your_key_here
```

Or mint a short-lived host-scoped token:

```bash
curl -X POST https://api.agentpay.so/api/mcp/tokens \
  -H "Authorization: Bearer apk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{ "audience": "openai", "ttlSeconds": 3600 }'
```

---

## Path B: REST API

### 1. Register

```bash
curl -s -X POST https://api.agentpay.so/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{ "name": "My Agent", "email": "you@example.com" }'
```

### 2. Read or set authority bootstrap

Read current authority state:

```bash
curl -s "https://api.agentpay.so/api/capabilities/authority-bootstrap?principalId=principal_1&subjectType=workspace&subjectRef=my-workbench&workbenchId=my-workbench" \
  -H "Authorization: Bearer apk_your_key_here"
```

Set terminal-native guardrails:

```bash
curl -s -X POST https://api.agentpay.so/api/capabilities/authority-bootstrap \
  -H "Authorization: Bearer apk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "principalId": "principal_1",
    "workbenchId": "my-workbench",
    "contactEmail": "you@example.com",
    "preferredFundingRail": "card",
    "autoApproveUsd": 5,
    "perActionUsd": 10,
    "dailyUsd": 50,
    "monthlyUsd": 500,
    "otpEveryPaidAction": false
  }'
```

### 3. Resolve provider access

Ask AgentPay whether governed access already exists:

```bash
curl -s -X POST https://api.agentpay.so/api/capabilities/access-resolve \
  -H "Authorization: Bearer apk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "databento",
    "subjectType": "workspace",
    "subjectRef": "my-workbench",
    "principalId": "principal_1",
    "workbenchId": "my-workbench",
    "workbenchLabel": "Main repo",
    "issueWorkbenchLease": true
  }'
```

Possible outcomes:

- `ready`: governed access already exists
- `auth_required`: a hosted setup flow is needed
- `pending_reuse`: a reusable setup flow is already in progress

### 4. Run hosted setup when needed

If access does not exist yet, create one hosted setup flow for authority and provider connection:

```bash
curl -s -X POST https://api.agentpay.so/api/capabilities/onboarding-sessions \
  -H "Authorization: Bearer apk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "subjectType": "workspace",
    "subjectRef": "my-workbench",
    "principalId": "principal_1",
    "providers": [
      { "provider": "firecrawl" },
      { "provider": "databento" }
    ]
  }'
```

The response includes a hosted onboarding URL. The human completes it once. AgentPay vaults the credential and stores the authority defaults.

### 5. Execute through a workbench lease

If `access-resolve` returned a workbench lease, use the opaque lease token instead of storing a raw provider key locally:

```bash
curl -s -X POST https://api.agentpay.so/api/capabilities/lease-execute \
  -H "Content-Type: application/json" \
  -d '{
    "leaseToken": "apcl_opaque_token_here",
    "workbenchId": "my-workbench",
    "method": "POST",
    "path": "/v1/crawl",
    "body": { "url": "https://example.com" }
  }'
```

If the call is still within free usage, it completes.
If the call needs paid usage, AgentPay returns a human step and later resumes the exact blocked call automatically.

### 6. Inspect or revoke local reuse

List current workbench leases:

```bash
curl -s "https://api.agentpay.so/api/capabilities/leases?principalId=principal_1&workbenchId=my-workbench" \
  -H "Authorization: Bearer apk_your_key_here"
```

Revoke one:

```bash
curl -s -X POST https://api.agentpay.so/api/capabilities/leases/lease_id_here/revoke \
  -H "Authorization: Bearer apk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "lost_device" }'
```

---

## Path C: Local development

### Prerequisites

- Node.js 20+
- Docker for local Postgres
- Wrangler for the Workers API

### Steps

```bash
git clone https://github.com/Rumblingb/Agentpay.git
cd Agentpay
npm ci
```

Set the minimum environment:

```bash
DATABASE_URL=postgresql://...
WEBHOOK_SECRET=...
AGENTPAY_SIGNING_SECRET=...
VERIFICATION_SECRET=...
ADMIN_SECRET_KEY=...
```

Optional but useful:

```bash
CAPABILITY_VAULT_ENCRYPTION_KEY=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
RESEND_API_KEY=...
```

Then run:

```bash
npm test -- --runInBand tests/routes/capabilities.test.ts tests/routes/hostedActions.test.ts tests/routes/stripeWebhooks.edge.test.ts
```

And for the growth lane:

```bash
npm run growth:run
```

---

## Product rule

If a human still has to:

- paste a raw provider key into chat
- rebuild a blocked call after payment
- keep reopening provider dashboards
- or lose continuity between approval and execution

then the product is still unfinished.
