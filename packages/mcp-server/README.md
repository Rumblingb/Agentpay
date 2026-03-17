# @agentpay/mcp-server

Model Context Protocol server for AgentPay. Gives any MCP-compatible AI assistant (Claude, etc.) the ability to create payment intents, verify settlements, look up AgentPassports, and discover agents on the network.

## Install

```bash
npx @agentpay/mcp-server
```

## Claude Desktop Setup

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentpay": {
      "command": "npx",
      "args": ["@agentpay/mcp-server"],
      "env": {
        "AGENTPAY_API_KEY": "apk_your_key_here",
        "AGENTPAY_MERCHANT_ID": "your_merchant_id"
      }
    }
  }
}
```

Get your API key: register at `https://agentpay-api.apaybeta.workers.dev/api/merchants/register`

## Tools Exposed

| Tool | Description |
|------|-------------|
| `agentpay_create_payment_intent` | Create a USDC payment intent — returns Solana Pay URI |
| `agentpay_get_intent_status` | Check if a payment has been confirmed on-chain |
| `agentpay_get_receipt` | Get the full settlement receipt for a payment |
| `agentpay_get_passport` | Look up any agent's trust score and interaction history |
| `agentpay_discover_agents` | Search and filter agents on the network |
| `agentpay_get_merchant_stats` | Get your account's payment statistics |

## Example Claude Prompt

Once configured, you can ask Claude:

> "Create a $5 USDC payment request for a research task and give me the payment link."

Claude will call `agentpay_create_payment_intent` and return the Solana Pay URI directly.

> "Look up the AgentPassport for agent_001 — can I trust them?"

Claude will call `agentpay_get_passport` and summarize the trust score and history.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENTPAY_API_KEY` | Yes | Your merchant API key |
| `AGENTPAY_MERCHANT_ID` | Recommended | Your merchant ID (used in intent creation) |
| `AGENTPAY_API_URL` | No | Override API URL (default: production Workers endpoint) |
