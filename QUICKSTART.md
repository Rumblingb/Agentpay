# Quickstart

Get your first agent payment working in under 5 minutes.

---

## 1. Register a merchant

```bash
curl -s -X POST https://api.agentpay.so/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Agent App",
    "email": "you@example.com",
    "walletAddress": "<your-solana-wallet-address>"
  }'
```

Response:
```json
{
  "success": true,
  "merchantId": "...",
  "apiKey": "..."
}
```

Save `merchantId` and `apiKey`. You will not see the API key again.

---

## 2. Create a payment intent

Agents call this endpoint — no API key required.

```bash
curl -s -X POST https://api.agentpay.so/api/v1/payment-intents \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "<merchant-id>",
    "agentId": "my-agent-01",
    "amount": 0.10,
    "currency": "USDC"
  }'
```

Response:
```json
{
  "success": true,
  "intentId": "...",
  "verificationToken": "APV_...",
  "expiresAt": "...",
  "instructions": {
    "crypto": {
      "network": "solana",
      "token": "USDC",
      "recipientAddress": "<merchant-wallet>",
      "amount": 0.10,
      "memo": "APV_...",
      "solanaPayUri": "solana:..."
    }
  }
}
```

---

## 3. Pay on Solana

Send `0.10 USDC` (SPL token `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) to `recipientAddress` with the `memo` set to the `verificationToken`.

Solana Pay URI can be scanned directly with Phantom or Solflare.

---

## 4. Submit the transaction hash

```bash
curl -s -X POST https://api.agentpay.so/api/v1/payment-intents/<intentId>/verify \
  -H "Content-Type: application/json" \
  -d '{ "txHash": "<solana-transaction-signature>" }'
```

This queues the hash for on-chain verification. The Solana listener confirms within ~30 seconds.

---

## 5. Get the receipt

```bash
curl -s https://api.agentpay.so/api/receipt/<intentId>
```

Response includes `intent`, `resolution` (once confirmed), and `settlement`.

---

## 6. Poll intent status

```bash
curl -s https://api.agentpay.so/api/v1/payment-intents/<intentId>
```

`status` transitions: `pending` → `confirmed` (on success) or `expired` (if TTL exceeded).

---

## Sandbox demo (no external services required)

Run the in-memory demo — no Postgres, Solana, or Stripe needed:

```bash
npm install
npx tsx examples/adapters/semiLiveDemo.ts
```

This runs a full `create → policy → verify` flow in a self-contained sandbox.

---

## Local development

Requires Docker (for Postgres) and Node.js 18+.

```bash
npm ci
cp .env.example .env       # fill in required secrets
npm run dev                # starts Node.js backend on :3001
npx wrangler dev           # starts Workers on :8787
```

Required secrets: `DATABASE_URL`, `WEBHOOK_SECRET`, `AGENTPAY_SIGNING_SECRET`, `VERIFICATION_SECRET`

Optional (for fee tracking): `PLATFORM_TREASURY_WALLET`, `PLATFORM_FEE_BPS` (default: 50)

---

## Next steps

- [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) — SDK, webhooks, protocol adapters
- [openapi.yaml](openapi.yaml) — full API reference
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design and data flow
