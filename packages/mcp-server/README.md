# @agentpayxyz/mcp-server

Model Context Protocol server for AgentPay. Gives any MCP-compatible AI assistant the ability to create payment intents, verify settlements, look up AgentPassports, manage the portable identity bundle, discover agents, and drive governed mandates on the canonical `/api/mandates` surface.

## Install

```bash
npx -y @agentpayxyz/mcp-server
```

## Hosted Remote MCP

If you are connecting AgentPay through a host that supports remote MCP, use the deployed endpoint instead of stdio:

- MCP endpoint: `https://api.agentpay.so/api/mcp`
- Discovery info: `https://api.agentpay.so/api/mcp/info`
- Pricing metadata: `https://api.agentpay.so/api/mcp/pricing`
- Host setup guide: `https://api.agentpay.so/api/mcp/setup`
- Demo flow: `https://api.agentpay.so/api/mcp/demo`
- Token mint endpoint: `https://api.agentpay.so/api/mcp/tokens`

You can authenticate with either:

```text
Authorization: Bearer apk_your_key_here
```

or a short-lived hosted MCP token minted from your AgentPay API key:

```bash
curl -X POST https://api.agentpay.so/api/mcp/tokens \
  -H "Authorization: Bearer apk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"audience":"openai","ttlSeconds":3600}'
```

The response includes an `accessToken` you can pass to OpenAI or Anthropic as the remote MCP bearer token.

Hosted MCP is priced as a headless control plane:
- `Launch`: free developer tier for evaluation
- `Builder`: $39/month, includes hosted MCP usage
- `Growth`: $149/month, higher included volume and lower overage
- `Funded actions`: 0.75% when AgentPay brokers the human funding step, plus underlying processor fees

See the public pricing metadata from `GET /api/mcp/pricing`, the host setup guide at `GET /api/mcp/setup`, and the north-star direction in `docs/AGENT_NATIVE_NORTH_STAR.md`.
Merchants can inspect current hosted MCP charges at `GET /api/mcp/billing/current` and create a payable checkout session at `POST /api/mcp/billing/checkout`.

## Claude Desktop Setup

Add to your `claude_desktop_config.json`:

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

Get your API key: register at `https://api.agentpay.so/api/merchants/register`

## Tools Exposed

| Tool | Description |
|------|-------------|
| `agentpay_create_payment_intent` | Create a USDC payment intent and return a Solana Pay URI |
| `agentpay_get_intent_status` | Check whether a payment has been confirmed on-chain |
| `agentpay_get_receipt` | Get the full settlement receipt for a payment |
| `agentpay_parse_upi_payment_request` | Parse and normalize a raw `upi://pay` URI or decoded QR payload through `/api/payments/upi/parse` |
| `agentpay_get_passport` | Look up an agent's trust score and interaction history |
| `agentpay_get_identity_bundle` | Fetch the portable identity bundle through `/api/foundation-agents/identity` |
| `agentpay_verify_identity_bundle` | Verify an agent identity through `/api/foundation-agents/identity` |
| `agentpay_provision_identity_inbox` | Provision or return a portable agent inbox through `/api/foundation-agents/identity` |
| `agentpay_send_identity_inbox_message` | Send from a provisioned agent inbox through `/api/foundation-agents/identity` |
| `agentpay_list_identity_inbox_messages` | List recent inbox messages through `/api/foundation-agents/identity` |
| `agentpay_start_identity_phone_verification` | Start a phone verification challenge through `/api/foundation-agents/identity` |
| `agentpay_confirm_identity_phone_verification` | Confirm a phone verification challenge through `/api/foundation-agents/identity` |
| `agentpay_link_identity_bundles` | Link multiple agent identities through `/api/foundation-agents/identity` |
| `agentpay_verify_identity_credential` | Verify an issued identity credential through `/api/foundation-agents/identity` |
| `agentpay_create_funding_setup_intent` | Create a reusable Stripe funding setup intent through `/api/payments/setup-intent` |
| `agentpay_confirm_funding_setup` | Confirm a completed Stripe funding setup through `/api/payments/confirm-setup` |
| `agentpay_list_funding_methods` | List saved principal funding methods through `/api/payments/methods/:principalId` |
| `agentpay_create_human_funding_request` | Create a host-native human funding request through `/api/payments/funding-request` with card-first funding and UPI fallback |
| `agentpay_list_capability_providers` | List the governed external capability catalog through `/api/capabilities/providers/catalog` |
| `agentpay_request_capability_connect` | Start a secure external capability connect session through `/api/capabilities/connect-sessions` |
| `agentpay_list_capabilities` | List connected external capabilities through `/api/capabilities` |
| `agentpay_get_capability` | Fetch one connected external capability through `/api/capabilities/:capabilityId` |
| `agentpay_execute_capability` | Execute an upstream API call through the governed proxy at `/api/capabilities/:capabilityId/execute` |
| `agentpay_create_mandate` | Create and plan a governed mandate on `/api/mandates` |
| `agentpay_get_mandate` | Fetch the full mandate record, including approval and execution state |
| `agentpay_get_mandate_journey_status` | Fetch the current journey/execution session for a mandate; `No journey session found` is expected until downstream dispatch starts |
| `agentpay_get_mandate_history` | Fetch the audit timeline for a mandate from `/api/mandates/:intentId/history` |
| `agentpay_approve_mandate` | Approve a mandate through `/api/mandates/:intentId/approve` |
| `agentpay_execute_mandate` | Start execution through `/api/mandates/:intentId/execute` |
| `agentpay_cancel_mandate` | Cancel or revoke a non-executing mandate through `/api/mandates/:intentId/cancel` |
| `agentpay_choose_requirement` | Agent-only chooser that compares MCP servers, agents, and governed capabilities and returns the safest next action |
| `registry_search` | Search the AgentPay MCP server registry by capability, category, transport, and price |
| `registry_server_info` | Get full server details and harness config after subscription |
| `registry_subscribe` | Subscribe to a free server or create a pending paid subscription that remains inactive until payment confirms |
| `registry_create_subscription_checkout` | Create Stripe Checkout for a pending paid registry subscription |
| `registry_installed` | List subscribed MCP servers |
| `registry_publish` | Publish an MCP server to the AgentPay registry with TOTP protection |
| `registry_verify_domain` | Verify an HTTP server listing by well-known file or DNS TXT record |
| `registry_usage` | View usage and earnings for published MCP servers |
| `registry_payouts` | View publisher payout history and pending earnings |
| `registry_enroll` | Enroll TOTP for publishing and paid subscription actions |
| `registry_confirm_totp` | Confirm TOTP enrollment |
| `agentpay_request_repo_access` | Request a hosted human step to choose repo access for an agent task; no token is exposed |
| `agentpay_list_repo_leases` | List scoped repo authority leases without provider tokens |
| `agentpay_revoke_repo_lease` | Revoke a repo authority lease immediately |
| `agentpay_discover_agents` | Search and filter agents on the network |
| `agentpay_get_merchant_stats` | Get your account's payment statistics |
| `agentpay_register_agent` | Register an AI agent on the network |
| `agentpay_get_agent` | Look up a registered agent's public identity record |

Money and repo safety rules:

- Paid registry subscriptions stay `pending_payment` until Stripe confirms payment by webhook.
- Per-call registry billing fails closed until metering and spend limits are active.
- Repo authority leases are scoped to selected repositories and operations. AgentPay never returns raw GitHub or GitLab tokens through MCP.

## Example Claude Prompt

Once configured, you can ask Claude:

> "Create a governed mandate to book a train from London to Manchester, and show me the current mandate state."

Claude will call `agentpay_create_mandate`, then `agentpay_get_mandate`, and return the mandate record directly.

> "Create a $5 USDC payment request for a research task and give me the payment link."

Claude will call `agentpay_create_payment_intent` and return the Solana Pay URI directly.

> "Parse this UPI payment request and tell me who it pays, how much it requests, and any reference fields: `upi://pay?pa=merchant@upi&pn=Demo%20Store&am=499.00&cu=INR&tn=Expo%20booth`"

Claude will call `agentpay_parse_upi_payment_request` and return the normalized UPI request fields directly.

> "Look up the AgentPassport for `agent_001`."

Claude will call `agentpay_get_passport` and summarize the trust score and history.

> "Get the portable identity bundle for `agent_001`."

Claude will call `agentpay_get_identity_bundle` against `/api/foundation-agents/identity` and return the verified identity record, linked identities, and trust state.

> "Verify this agent identity and return the credential."

Claude will call `agentpay_verify_identity_bundle` and return the issued credential and trust level.

> "Provision an inbox for `agent_001` and show me the address."

Claude will call `agentpay_provision_identity_inbox` and return the portable inbox identity.

> "Send `traveler@example.com` a handled-trip email from `agent_001`."

Claude will call `agentpay_send_identity_inbox_message` and return the message result.

> "Show me the last 10 inbox messages for `agent_001`."

Claude will call `agentpay_list_identity_inbox_messages` and return the recent inbox timeline.

> "Start phone verification for `agent_001` at `+447700900123`."

Claude will call `agentpay_start_identity_phone_verification` and return the verification challenge details.

> "Confirm phone verification for `agent_001` with verification ID `verif_123` and code `123456`."

Claude will call `agentpay_confirm_identity_phone_verification` and return the confirmed phone verification state.

> "Create a reusable funding setup for `principal_001` so my agent can save a card for governed spending."

Claude will call `agentpay_create_funding_setup_intent` and return the Stripe setup intent details.

> "List the funding methods saved for `principal_001`."

Claude will call `agentpay_list_funding_methods` and return the saved payment methods.

> "Create a UPI funding request for ₹499 so the human can pay without leaving the chat."

Claude will call `agentpay_create_human_funding_request` and return a `nextAction` payload with a short URL and UPI QR/deep-link data the host can render inline.

> "Create a card funding request for GBP 49 so the human can pay without leaving the chat."

Claude will call `agentpay_create_human_funding_request` and return a `nextAction` payload with a Stripe Checkout URL the host can render inline or open as a scoped secure step.

> "Connect Firecrawl without exposing the raw API key to the agent."

Claude will call `agentpay_request_capability_connect` and return an `auth_required` connect session. The human completes the secure step, AgentPay vaults the key, and future calls use only the returned capability reference.

> "Run this scrape through the connected Firecrawl capability and ask before spending past the free tier."

Claude will call `agentpay_execute_capability`. AgentPay injects the vaulted credential, enforces the allow-listed host, and returns `approval_required` once the free-call allowance is exhausted.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENTPAY_API_KEY` | Yes | Your merchant API key |
| `AGENTPAY_MERCHANT_ID` | Recommended | Your merchant ID (used in intent creation) |
| `AGENTPAY_API_URL` | No | Override API URL (default: production Workers endpoint) |
