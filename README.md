# AgentPay

AgentPay is governed payment infrastructure for AI agents: scoped authority, approval gates, receipts, and a practical fleet-control surface for agent-run work.

## Casper Buildathon Entry

**Bee + Clickey: Founder-in-a-Box with Casper-Verifiable Agent Payments**

Bee is the operator brain. Clickey is the desktop companion. Together they route work across a real local AI fleet, discover tools through the AgentPay Feed MCP, and stage payment receipts through founder-approved rails. For the Casper Agentic Buildathon, the project adds a Casper-native receipt path: Bee can stage `x402-casper` payment payloads and bind a Bee mandate/receipt id to a Casper Testnet transfer.

Start here:

- [Submission packet](CASPER_AGENTIC_BUILDATHON_SUBMISSION.md)
- [Post-deadline recovery packet](CASPER_POST_DEADLINE_RECOVERY_PACKET.md)
- [Bee control plane](ops/mac-mini/bee/README.md)
- [Casper receipt runner](ops/mac-mini/bee/casper/README.md)

## What Judges Can Verify

```bash
node --test ops/mac-mini/bee/bee.test.mjs
ops/mac-mini/bin/bee doctor
ops/mac-mini/bin/bee caps
ops/mac-mini/bin/bee feed
npm --prefix ops/mac-mini/bee/casper run proof
npm --prefix ops/mac-mini/bee/casper run video
```

The Casper Testnet runner is isolated from the mobile app package and uses the official Casper JavaScript SDK:

```bash
npm --prefix ops/mac-mini/bee/casper install
BEE_CASPER_RECEIPT_ID=bee-dryrun-proof \
npm --prefix ops/mac-mini/bee/casper run receipt -- --dry-run
```

Broadcasting a real testnet proof requires a funded Casper testnet key:

```bash
CASPER_PRIVATE_KEY_HEX=<testnet-private-key-hex> \
CASPER_RECIPIENT_PUBLIC_KEY_HEX=<recipient-public-key-hex> \
BEE_CASPER_RECEIPT_ID=<bee-mandate-id-or-demo-receipt-id> \
npm --prefix ops/mac-mini/bee/casper run receipt
```

`npm --prefix ops/mac-mini/bee/casper run video` creates a local MP4 demo asset under `ops/mac-mini/bee/casper/demo-artifacts/`. It is intentionally ignored from source; upload it publicly only after final founder approval.

## Safety Model

Bee can prepare and stage high-impact actions, but it does not autonomously publish, upload, change OAuth/account settings, move money, or bypass founder approval. Payment mandates are signed, nonce-guarded, cap-checked, and approval-bound before settlement. Live settlement remains founder-triggered.
