# First Payment (Developer Happy Path)

This document describes a lightweight, developer-focused happy path to create a payment, settle it on-chain, verify the settlement, and receive a webhook.

Flow

1. Create payment
   - POST `/api/merchants/payments` with `Authorization: Bearer <API_KEY>` and body:
     ```json
     { "amountUsdc": 1.5, "recipientAddress": "<recipient wallet>" }
     ```
   - Response: `{ success: true, transactionId, paymentId, amount, recipientAddress, instructions }`

2. Send USDC
   - Use the `recipientAddress` from the create response and send the required USDC amount on-chain (or via Stripe in future phases).
   - The settlement listener (Solana listener) ingests on-chain evidence and updates the `transactions` row with `transaction_hash`, `confirmation_depth`, and `status`.

3. Verify payment
   - POST `/api/merchants/payments/:transactionId/verify` with `Authorization: Bearer <API_KEY>` and body:
     ```json
     { "txHash": "<on-chain-transaction-hash>" }
     ```
   - Note: the request must use `txHash` (not `transactionHash`). The API will reject the legacy `transactionHash` key.
   - Response (Phase 1 canonical shape):
     ```json
     {
       "paymentId": "...",
       "status": "confirmed|pending|failed|...",
       "verified": true|false,
       "amount": 1.5,
       "token": "USDC",
       "payer": "payer-wallet-or-null",
       "recipient": "recipient-wallet",
       "txHash": "...",
       "verifiedAt": "2026-03-15T12:34:56.789Z|null",
       "receipt": {
         "receiptId": "...",
         "transactionId": "...",
         "payer": "...",
         "recipient": "...",
         "amount": 1.5,
         "token": "USDC",
         "txHash": "...",
         "timestamp": "2026-03-15T12:34:56.789Z"
       }
     }
     ```

4. Receive webhook
   - If you have configured a webhook URL (merchant profile), when settlement is finalized the system will emit a webhook event with the canonical receipt. (Webhook emission is covered by the webhook delivery subsystem.)

Notes and Scope

- This guide covers a minimal developer path for Phase 1/Phase 2. It intentionally keeps the surface small: no certificate signing, no SDK changes, no docs or dashboard UI changes are made in this PR.
- The `verify` endpoint returns a canonical receipt object to make it easy for SDKs and integrators to verify settlement and produce receipts.
- The server determines `verified` from the existing settlement `status` (e.g. `confirmed`) and does not change settlement logic.

Example

See `examples/simple-payment.ts` for a runnable Node-style example that hits the `create` and `verify` endpoints.
