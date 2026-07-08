# Bee + Clickey Casper Demo Script

Target length: 60-90 seconds.

## Shot List

1. Open on the Clickey/Bee dashboard.
   - Line: "Bee is the founder-in-a-box: Clickey is the desktop body, Bee is the operator brain, and AgentPay is the authority and payment rail."
2. Show capabilities.
   - Command: `ops/mac-mini/bin/bee caps`
   - Point out agents, skills, MCP entries, local tools, and the earn/spend rails.
3. Show AgentPay Feed.
   - Command: `ops/mac-mini/bin/bee feed`
   - Line: "This is the capability radar: new tools and upgrades can flow into Bee's routing layer."
4. Show Casper rail.
   - Command: `BEE_CASPER_RECEIPT_ID=bee-demo-proof npm --prefix ops/mac-mini/bee/casper run receipt -- --dry-run`
   - Line: "Bee stages a Casper-native receipt payload and binds the Bee mandate id to a Casper transfer id."
5. Show safety.
   - Command: `ops/mac-mini/bin/bee doctor`
   - Line: "The wall is intact. Bee can prepare high-impact actions, but live settlement and public submissions stay founder-approved."
6. Close with qualification proof.
   - After the funded testnet broadcast, show the `testnet.cspr.live/deploy/<hash>` URL.
   - Line: "Casper becomes the proof layer for human-approved agent commerce."

## DoraHacks Copy

Title:
Bee + Clickey: Founder-in-a-Box with Casper-Verifiable Agent Payments

Short description:
Bee + Clickey is a founder-in-a-box for agent-run businesses: a desktop companion that sees work, routes it to a real AI fleet, discovers MCP tools through AgentPay Feed, and stages Casper/x402 payment receipts behind explicit founder approval.

Casper message:
Casper is the audit and settlement layer for Bee's agent economy. Bee discovers a capability, prices the work, asks Clickey for explicit founder approval, and stages a signed `x402-casper` payload with a Casper memo, nonce, and approval attestation. The agent never moves funds by itself; Casper becomes the durable proof that a human-approved agent action, payment intent, and receipt belong together.
