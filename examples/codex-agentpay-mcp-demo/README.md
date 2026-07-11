# Codex + AgentPay MCP agentic demo

This demo shows the product moment in one local run:

1. A Codex-style agent sees leaked provider credentials in another agent's output.
2. It calls `agentpay_scan_for_leaked_secrets` through the AgentPay MCP server.
3. It refuses to keep using raw keys and asks AgentPay to buy/reuse `market_data` access under a budget.
4. AgentPay returns human-step resume tokens.
5. The agent resumes the exact blocked call after setup/approval instead of reconstructing it.

The default mode uses the real AgentPay MCP server over stdio and a local mock AgentPay API. That keeps the demo safe, deterministic, and free while still exercising the MCP tool surface.

## Run the safe demo

```bash
node examples/codex-agentpay-mcp-demo/agentic-demo.mjs
```

Every run writes sanitized proof artifacts:

```text
demo-recordings/latest-codex-agentpay-mcp-demo.md
demo-recordings/latest-codex-agentpay-mcp-demo.json
```

Expected story:

- MCP exposes `agentpay_scan_for_leaked_secrets`, `agentpay_buy_api`, and `agentpay_execute_with_resume_token`.
- Leak Guard returns only redacted fingerprints and `rawSecretsReturned: false`.
- The first `agentpay_buy_api` call pauses for provider setup and returns an `apsetup_...` resume token.
- The second access call reaches paid execution and returns a `capresume_...` exact-call token.
- The final resume returns a mock market-data result without exposing any provider secret.

## Run against live AgentPay

Configure the key once:

```bash
cd /Users/brain/agentpay-demo-qa
npx agentpay config --api-key apk_your_key_here --api-url https://api.agentpay.so
```

Then run:

```bash
AGENTPAY_API_KEY=apk_your_key_here \
node examples/codex-agentpay-mcp-demo/agentic-demo.mjs \
  --live \
  --principal-id principal_your_id \
  --customer-phone +15555550100
```

Live mode may create real hosted setup, approval, or paid execution steps depending on your AgentPay policy and provider state.

For a full prompt-driven Codex walkthrough, see [docs/CODEX_AGENTPAY_DEMO_SCRIPT.md](../../docs/CODEX_AGENTPAY_DEMO_SCRIPT.md).

## Screen-recording script

Use this narration:

```text
Codex is acting like a real autonomous worker. It sees another agent leak a Stripe restricted key, but instead of copying or reusing the key, it calls AgentPay MCP.

AgentPay returns a redacted finding, a fingerprint, and an operational decision. Raw secrets never come back into the model context.

The agent still needs market data, so it asks AgentPay to buy or reuse market_data access under a $5 budget. AgentPay either reuses a workbench lease or pauses for the minimal human step.

When setup or payment approval is needed, AgentPay returns a resume token. Codex stores that token, waits for the human step, and resumes the exact blocked call server-side. The provider key never enters chat, logs, or the agent process.
```
