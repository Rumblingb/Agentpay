# Bee Casper Receipt Runner

This small package gives Bee a Casper Testnet transaction-producing proof path for the Casper Agentic Buildathon.

It broadcasts a native CSPR transfer deploy using `casper-js-sdk`, with a deterministic transfer id derived from `BEE_CASPER_RECEIPT_ID`. That lets a Bee mandate or receipt id be referenced in a Casper Testnet deploy and linked back to the founder-approved AgentPay workflow.

## Install

```bash
npm --prefix ops/mac-mini/bee/casper install
```

## Dry Run

The dry run builds signed transfer metadata without broadcasting. If no keypair is provided, it generates throwaway keys in memory:

```bash
BEE_CASPER_RECEIPT_ID=bee-dryrun-proof \
npm --prefix ops/mac-mini/bee/casper run receipt -- --dry-run
```

## Local Proof Bundle

This runs the Bee tests, health check, capability scan output, AgentPay Feed check, and Casper dry-run, then writes JSON and Markdown receipts under `ops/mac-mini/bee/casper/proofs/`.

```bash
npm --prefix ops/mac-mini/bee/casper run proof
```

## Local Demo Video

This regenerates a local MP4 from the proof bundle and writes it under `ops/mac-mini/bee/casper/demo-artifacts/`.

```bash
npm --prefix ops/mac-mini/bee/casper run video
```

The generated video is intentionally ignored from source. Upload or publish it only after founder approval.

## Broadcast Testnet Proof

Use a dedicated funded Casper testnet key. Do not use a mainnet key.

```bash
CASPER_PRIVATE_KEY_HEX=<testnet-private-key-hex> \
CASPER_RECIPIENT_PUBLIC_KEY_HEX=<recipient-public-key-hex> \
BEE_CASPER_RECEIPT_ID=<bee-mandate-id-or-demo-receipt-id> \
npm --prefix ops/mac-mini/bee/casper run receipt
```

Optional environment:

```bash
CASPER_RPC_URL=https://node.testnet.casper.network/rpc
CASPER_CHAIN_NAME=casper-test
CASPER_KEY_ALGORITHM=ED25519
CASPER_AMOUNT_MOTES=100000000
CASPER_PAYMENT_MOTES=100000000
```

The command prints a `deploy_hash` and `https://testnet.cspr.live/deploy/<hash>` URL when broadcast succeeds.
