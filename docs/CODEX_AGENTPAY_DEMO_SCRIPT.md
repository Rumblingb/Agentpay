# Codex + AgentPay MCP Demo Script

This is the live prompt path for showing AgentPay as a real Codex MCP capability.

Use the scripted demo first when you need a deterministic recording:

```bash
npm run doctor:codex-agentpay-mcp
npm run demo:codex-agentpay-mcp
```

The scripted run writes:

```text
demo-recordings/latest-codex-agentpay-mcp-demo.md
demo-recordings/latest-codex-agentpay-mcp-demo.json
```

## Setup

Register the local Codex MCP launcher once:

```bash
codex mcp add agentpay -- node /Users/brain/agentpay-demo-qa/scripts/agentpay-codex-mcp.mjs
```

Configure the live AgentPay API key once:

```bash
cd /Users/brain/agentpay-demo-qa
npx agentpay config --api-key apk_your_key_here --api-url https://api.agentpay.so
```

The launcher reads `~/.agentpay/config.json`, so the API key does not need to be hardcoded into Codex MCP config.

## Live Codex Prompt

Paste this into a fresh Codex thread with AgentPay MCP enabled:

```text
Use AgentPay MCP.

You are an autonomous coding agent debugging a market-data workflow.
First scan this worker output for leaked secrets. Do not return raw secrets.

<worker_output>
Build logs from autonomous worker:
STRIPE_RESTRICTED_KEY=rk_live_1234567890abcdefghijkl
Next step: call market data API directly from the agent process.
</worker_output>

If a leak is found:
- tell me the redacted finding only
- tell me whether raw secrets were returned
- tell me the rotation/vault action
- decide whether the current agent session should be killed

Then buy or reuse governed API access for market_data under a $5 limit.
Prefer reliability.
Notify my phone if approval is needed.
If AgentPay returns a resume token, store it and resume the exact blocked call with agentpay_execute_with_resume_token after the human step completes.
Do not ask me to paste a raw provider key into chat.
```

## What Good Looks Like

The Codex answer should show these proof points:

- AgentPay MCP was called, not a local regex or hand-written mock.
- The leak scan returns a redacted value such as `rk_liv...ijkl`.
- `secretHandling.rawSecretsReturned` is `false`.
- The agent changes behavior and stops using raw provider credentials.
- `agentpay_buy_api` is used for `market_data` with a budget cap.
- Human setup or paid approval returns a resume token.
- `agentpay_execute_with_resume_token` is used to resume the stored call.
- The provider credential never appears in Codex output.

## Recording Beats

1. Show the prompt with the leaked key.
2. Show the MCP call to `agentpay_scan_for_leaked_secrets`.
3. Pause on `rawSecretsReturned: false`.
4. Show the agent requesting `market_data` through AgentPay.
5. Pause on the `apsetup_...` or `capresume_...` token.
6. Show exact-call resume.
7. End on the agent's final answer: no raw secrets, governed access, resumable human step, completed result.

## Fallback

If live provider setup is not ready, use:

```bash
npm run demo:codex-agentpay-mcp -- --compact
```

That path still exercises the real AgentPay MCP stdio server but points it at a local mock AgentPay API, so it is safe for demos and CI.
