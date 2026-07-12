# Bee + Clickey + AgentPay: Founder-in-a-Box for the Casper Agent Economy

## DoraHacks short description

Bee + Clickey is a founder-in-a-box for agent-run businesses: a desktop companion that sees work, routes it to a real AI fleet, discovers new MCP tools through an AgentPay capability feed, and stages Casper/x402 payment receipts behind explicit founder approval.

## Project links

- Repository: https://github.com/Rumblingb/Agentpay
- Feed MCP: https://github.com/Rumblingb/agentpay-feed-mcp
- Feed worker: https://github.com/Rumblingb/agentpay-feed-worker
- Demo video: https://github.com/Rumblingb/Agentpay/releases/download/casper-buildathon-demo-2026-07-08/bee-clickey-casper-local-demo.mp4
- Local demo artifact: `ops/mac-mini/bee/casper/demo-artifacts/bee-clickey-casper-local-demo.mp4`
- Post-deadline recovery packet: `CASPER_POST_DEADLINE_RECOVERY_PACKET.md`

## Casper Network message

Casper is the audit and settlement layer for Bee's agent economy. Bee discovers a capability, prices the work, asks Clickey for explicit founder approval, and stages a signed `x402-casper` payload with a Casper memo, nonce, and approval attestation. The agent never moves funds by itself; Casper becomes the durable proof that a human-approved agent action, payment intent, and receipt belong together.

## What it does

Bee is the orchestrator brain and Clickey is the desktop body. Together they:

1. Scan the founder's live agent fleet, local skills, and MCP servers into a capability registry.
2. Poll AgentPay Feed MCP for new tools, capability updates, and runtime events.
3. Route tasks across Claude, Codex, Hermes, Nemotron, computer-use, and local Gemma by cost, risk, and skill fit.
4. Keep external effects on an approval wall: OAuth, uploads, publishing, payments, and account changes require founder action-time approval.
5. Stage payment mandates as signed rail payloads, including a Casper-native `x402-casper` path for CSPR/USDC receipts.
6. Show the whole system in the Clickey dashboard: active work, approvals, fund wall status, automation loops, and the live tool feed.

The key product loop is:

```text
Capability feed -> Bee decides -> worker ships -> Clickey asks -> founder approves -> Casper receipt staged
```

## Why it fits the Casper Agentic Buildathon

- Agentic AI: Bee is not a chat page; it is an always-on router and operator with persistent memory, worker dispatch, voice, screen awareness, and status loops.
- DeFi/x402: Bee sells and buys agent capabilities through x402-style payment terms and signed mandates.
- Casper Network: this polish adds a Casper-native settlement payload, turning approvals into Casper-verifiable receipts instead of leaving agent payments as off-chain chat logs.
- Real-world assets/enterprise operations: Bee treats each tool, subscription, and service as a governed capability with budget, proof, and receipt requirements.
- Safety: high-impact actions are fail-closed by code, with a separate founder wall and no autonomous money movement.

## What is real today

- Bee doctor is green on the Mac demo machine: DB, Gemma brain, Kokoro voice, Voicebox fallback, daemon, pull service, Clickey desk, mandate key, registry, and wall checks.
- Registry is present with 6 agents, 53 skills, and 10 MCP entries.
- AgentPay Feed is live at `https://agentpay-feed.apaybeta.workers.dev` with signed event schema, stats, trust levels, and tool registration categories.
- Bee consumes the feed through `bee feed` / `bee feed-json` and the Clickey dashboard.
- Payment mandates are signed with HMAC, approval-bound, nonce-guarded, capped, and staged before settlement.
- Casper rail support now emits `protocol: "x402-casper"`, `chain: "casper"`, `asset: "CSPR"` or `USDC`, memo, nonce, and approval attestation.
- A Casper Testnet receipt runner lives at `ops/mac-mini/bee/casper/send-receipt.mjs`. It builds and broadcasts a native CSPR transfer deploy that binds a Bee receipt id to a Casper transfer id.

## Honest sandbox/live boundary

The buildathon demo uses sandbox settlement for safety. Bee stages the exact rail payload and can execute sandbox receipts for the video. Live payment execution remains founder-triggered after action-time approval; Bee records the provider receipt after the founder completes it.

The Qualification Round disclaimer requires a transaction-producing Casper Testnet component. Before a final DoraHacks update, appeal, or submission attempt, broadcast one testnet receipt from a funded Casper testnet account and add the resulting `https://testnet.cspr.live/deploy/<hash>` link to this file, the demo description, and `CASPER_POST_DEADLINE_RECOVERY_PACKET.md`.

## Demo script

1. Open Clickey/Bee dashboard and show healthy status.
2. Run `bee caps` to show the live capability registry.
3. Run `bee feed` to show AgentPay's tool and upgrade feed.
4. Ask Bee to buy verified capability data for a launch task on Casper.
5. Bee issues a mandate with `--rail casper --sandbox`.
6. Clickey prompts for approval; the founder approves with the tick gesture or CLI for the recording.
7. Bee re-checks guard rails and stages an `x402-casper` payload.
8. Bee sandbox-settles and records a Casper-style receipt.
9. Close on the dashboard: task shipped, approval resolved, receipt available.

## Verification commands

```bash
cd /Users/brain/Agentpay
node --test ops/mac-mini/bee/bee.test.mjs
ops/mac-mini/bin/bee doctor
ops/mac-mini/bin/bee caps
ops/mac-mini/bin/bee feed
ops/mac-mini/bin/bee mandate 3 casper-capability-feed "buy verified MCP capability data" --rail casper --sandbox
```

For the final demo, approve the sandbox mandate and then run:

```bash
ops/mac-mini/bin/bee settle <mandate-id> --execute
```

For the real Casper Testnet proof, fund a dedicated testnet account and run:

```bash
cd /Users/brain/Agentpay
npm --prefix ops/mac-mini/bee/casper install
CASPER_PRIVATE_KEY_HEX=<testnet-private-key-hex> \
CASPER_RECIPIENT_PUBLIC_KEY_HEX=<recipient-public-key-hex> \
BEE_CASPER_RECEIPT_ID=<bee-mandate-id-or-demo-receipt-id> \
npm --prefix ops/mac-mini/bee/casper run receipt
```

Dry-run check, without broadcasting:

```bash
BEE_CASPER_RECEIPT_ID=bee-dryrun-proof npm --prefix ops/mac-mini/bee/casper run receipt -- --dry-run
```

## Suggested DoraHacks title

Bee + Clickey: Founder-in-a-Box with Casper-Verifiable Agent Payments

## Suggested tags

Agentic AI, Casper Network, x402, MCP, DeFi, RWA, AI Agents, Capability Registry, Agent Payments
