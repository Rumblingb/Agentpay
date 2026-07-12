# Casper Agentic Buildathon Recovery Packet

Generated: 2026-07-08

## Current DoraHacks State

- Hackathon page: https://dorahacks.io/hackathon/casper-agentic-buildathon/buidl
- Live page status observed in Chrome: `Submission period ended`; `Submit BUIDL` and `Register as Hacker` are disabled.
- Timeline observed: submission opened `2026/06/01 01:00`, deadline `2026/07/01 01:00`, extended deadline `2026/07/08 00:59`.
- Requirement fields observed: GitHub/Gitlab/Bitbucket link, demo video, Casper Network message.
- Public BUIDLs observed: `253`.

## Same-Name Public BUIDL Found

A public DoraHacks BUIDL named `AgentPay` is visible at:

- https://dorahacks.io/buidl/46805

Observed page facts:

- Owner/team surface shows `Daniel` / `@timidan_x`.
- Repository link: https://github.com/Timidan/agentpay-trust-pass
- Demo link: https://youtu.be/AH4m0DoYNZA
- App link: https://agentpay.timidan.xyz/
- The page includes Casper Testnet links for a settlement transaction and a decision deploy.
- No edit or manage control was visible in the current Chrome session.

Treat this as a separate public AgentPay-named BUIDL unless the founder confirms that the Timidan/Daniel account is controlled by our team.

## Our Prepared Submission

Title:

Bee + Clickey: Founder-in-a-Box with Casper-Verifiable Agent Payments

Primary repo:

https://github.com/Rumblingb/Agentpay

Submission packet:

- `CASPER_AGENTIC_BUILDATHON_SUBMISSION.md`
- `CASPER_DEMO_SCRIPT.md`
- `README.md`
- `ops/mac-mini/bee/casper/README.md`

Local proof bundle:

- `ops/mac-mini/bee/casper/proofs/casper-buildathon-proof-2026-07-08T16-07-30-319Z.md`
- `ops/mac-mini/bee/casper/proofs/casper-buildathon-proof-2026-07-08T16-07-30-319Z.json`

Local demo video:

- `ops/mac-mini/bee/casper/demo-artifacts/bee-clickey-casper-local-demo.mp4`
- Public URL: https://github.com/Rumblingb/Agentpay/releases/download/casper-buildathon-demo-2026-07-08/bee-clickey-casper-local-demo.mp4
- Verified: 1920x1080, 38 seconds, 1140 frames.

## Verified Today

```bash
node --test ops/mac-mini/bee/bee.test.mjs
ops/mac-mini/bin/bee doctor
ops/mac-mini/bin/bee feed
npm --prefix ops/mac-mini/bee/casper run proof
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,nb_frames,duration -of json ops/mac-mini/bee/casper/demo-artifacts/bee-clickey-casper-local-demo.mp4
```

Results:

- Bee test suite: `15/15` pass.
- Bee doctor: all green; wall intact, no fund leak.
- AgentPay Feed: reachable; `44 published`, `44 live`, no live events at check time.
- Local proof bundle: generated successfully.
- Demo video: valid local MP4.

## External Actions Still Approval-Gated

No external action has been taken from this packet.

The next real-world steps require explicit action-time founder approval:

1. Push the relevant GitHub changes to `Rumblingb/Agentpay`.
2. Upload or publish the demo MP4 to a public URL.
3. Broadcast a funded Casper Testnet receipt.
4. Submit/update/appeal on DoraHacks or message the organizers.

## Casper Testnet Broadcast Command

Use a dedicated funded Casper testnet key. Do not use a mainnet key.

```bash
cd /Users/brain/Agentpay
CASPER_PRIVATE_KEY_HEX=<testnet-private-key-hex> \
CASPER_RECIPIENT_PUBLIC_KEY_HEX=<recipient-public-key-hex> \
BEE_CASPER_RECEIPT_ID=bee-demo-1783526849676 \
npm --prefix ops/mac-mini/bee/casper run receipt
```

Expected success output includes:

- `deploy_hash`
- `https://testnet.cspr.live/deploy/<hash>`

## Late Organizer Message Draft

Subject:

Casper Agentic Buildathon - Bee + Clickey AgentPay submission packet

Body:

Hello DoraHacks/Casper team,

We prepared Bee + Clickey: Founder-in-a-Box with Casper-Verifiable Agent Payments for the Casper Agentic Buildathon qualification round. The public DoraHacks page now shows the submission period ended after the 2026-07-08 00:59 extension, so I am sending the final packet here in case late review or a project update route is still possible.

Project:

- Bee + Clickey routes a real AI founder fleet, discovers capabilities through AgentPay Feed MCP, stages founder-approved agent payment mandates, and binds receipts to Casper Testnet proof.
- Repository: https://github.com/Rumblingb/Agentpay
- Demo video: https://github.com/Rumblingb/Agentpay/releases/download/casper-buildathon-demo-2026-07-08/bee-clickey-casper-local-demo.mp4
- Casper Testnet deploy: <testnet-deploy-url>

Casper message:

Casper is the audit and settlement layer for Bee's agent economy. Bee discovers a capability, prices the work, asks Clickey for explicit founder approval, and stages a signed `x402-casper` payload with a Casper memo, nonce, and approval attestation. The agent never moves funds by itself; Casper becomes the durable proof that a human-approved agent action, payment intent, and receipt belong together.

Thank you for considering it.
