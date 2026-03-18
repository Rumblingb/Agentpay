# AgentPay

Payment infrastructure for autonomous agents — create payment intents, verify settlement, enforce spending policy, and build portable economic reputation through AgentPassport.

<p align="center">
  <a href="https://github.com/Rumblingb/Agentpay/actions/workflows/ci.yml"><img src="https://github.com/Rumblingb/Agentpay/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./openapi.yaml"><img src="https://img.shields.io/badge/OpenAPI-3.1-85EA2D?logo=swagger" alt="OpenAPI 3.1"></a>
  <img src="https://img.shields.io/badge/status-beta-blue" alt="Beta">
</p>

---

## What it does

AgentPay gives agents a payment identity and the infrastructure to transact autonomously — without a human in the loop for every payment.

- **AgentPassport** — portable identity and spending policy per agent
- **Payment intents** — create, verify, and settle USDC payments on Solana
- **Policy engine** — per-merchant rules: amount caps, daily limits, allowlists, approval thresholds
- **Trust graph** — every settlement builds verifiable economic reputation
- **Fee ledger** — every payment records a fee obligation; the reconciler collects to treasury automatically
- **Escrow (A2A)** — lock-and-release for agent-to-agent service contracts
- **Multi-protocol** — x402, AP2, ACP, Solana Pay, Stripe (fiat)

---

## Quick start

**1. Register a merchant and get an API key**

```bash
POST https://api.agentpay.so/api/merchants/register
{
  "name": "My Agent App",
  "email": "you@example.com",
  "walletAddress": "<your-solana-wallet>"
}
```

Returns `{ merchantId, apiKey }`. Store both securely.

**2. Create a payment intent (agent-initiated, no API key needed)**

```bash
POST https://api.agentpay.so/api/v1/payment-intents
{
  "merchantId": "<merchant-id>",
  "agentId": "my-agent-01",
  "amount": 0.10,
  "currency": "USDC"
}
```

Returns `intentId`, `verificationToken`, and a Solana Pay URI.

**3. Pay on-chain**

Send USDC to `instructions.crypto.recipientAddress` with the `memo` set to `verificationToken`.

**4. Submit the transaction hash**

```bash
POST /api/v1/payment-intents/:intentId/verify
{ "txHash": "<solana-tx-signature>" }
```

**5. Get the receipt**

```bash
GET /api/receipt/:intentId
```

---

## API reference

Full spec: [`openapi.yaml`](openapi.yaml) — browsable at `/api/docs` on the Workers deployment.

Base URL: `https://api.agentpay.so`

| Route | Auth | Description |
|-------|------|-------------|
| `POST /api/merchants/register` | none | Register merchant, get API key |
| `GET /api/merchants/profile` | API key | Get merchant profile |
| `PATCH /api/merchants/profile/wallet` | API key | Update payout wallet address |
| `PATCH /api/merchants/profile/webhook` | API key | Set outgoing webhook URL |
| `POST /api/merchants/rotate-key` | API key | Rotate API key |
| `GET /api/merchants/stats` | API key | Payment statistics |
| `POST /api/intents` | API key | Create payment intent (merchant-facing) |
| `GET /api/intents` | API key | List payment intents |
| `POST /api/v1/payment-intents` | none | Create payment intent (agent-facing) |
| `GET /api/v1/payment-intents/:id` | none | Poll intent status |
| `POST /api/v1/payment-intents/:id/verify` | none | Submit on-chain tx hash |
| `GET /api/receipt/:intentId` | none | Get settlement receipt |
| `GET /api/verify/:txHash` | none | Verify by transaction hash (HMAC-signed) |
| `GET /api/health` | none | Health check |

Authentication: `Authorization: Bearer <api_key>` or `X-Api-Key: <api_key>`

---

## Architecture

```
Cloudflare Workers (apps/api-edge)   ← public API surface
  ├── Hono router
  ├── PBKDF2 auth middleware
  ├── Policy engine (AgentPassport)
  ├── Settlement identity + matching policy
  ├── Fee ledger outbox (fee_ledger_entries)
  └── Cron triggers (*/5 balance alerts, */15 reconciliation)

Node.js backend (src/)              ← services that need Node APIs
  ├── Solana listener (30s poll)    ← confirms on-chain payments
  ├── Reconciliation daemon (15m)
  └── Webhook delivery

Database: PostgreSQL via Supabase
  ├── payment_intents
  ├── settlement_identities
  ├── intent_resolutions
  ├── fee_ledger_entries            ← outbox for treasury fee collection
  ├── merchants + agent_wallets
  └── trust_events + agentrank_scores
```

---

## Free vs paid

| Feature | Free |
|---------|------|
| Merchant registration | yes |
| AgentPassport identity | yes |
| Create payment intents | yes |
| Policy engine | yes |
| Receipt generation | yes |
| Platform fee on settled payments | 0.5% (50 bps) to treasury |

The platform fee is recorded in `fee_ledger_entries` at intent creation and collected after settlement confirmation. Fee configuration is per-merchant (`feeConfiguration` on `payment_intents`).

---

## Developer resources

- [QUICKSTART.md](QUICKSTART.md) — run your first payment in 5 minutes
- [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) — SDK, webhooks, protocol adapters
- [openapi.yaml](openapi.yaml) — full OpenAPI 3.1 spec
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) — environment variables reference

---

## Repository layout

```
apps/api-edge/     Cloudflare Workers API (primary public surface)
src/               Node.js backend services (Solana listener, reconciler)
infra/prisma/      Database schema (Prisma + raw SQL migrations)
sdk/               TypeScript + Python SDKs
packages/          Shared libraries
examples/          Integration examples
scripts/           One-time ops scripts
```

---

## npm packages

```bash
npm install @agentpayxyz/sdk        # JavaScript / TypeScript SDK
npx @agentpayxyz/mcp-server         # MCP server for Claude Desktop
```

> **Note:** The npm scope is `@agentpayxyz` while an `@agentpay` org claim is pending with npm. The package names and APIs will not change when the scope transfers.

---

## Support

- Issues: [github.com/Rumblingb/Agentpay/issues](https://github.com/Rumblingb/Agentpay/issues)
- API spec: [openapi.yaml](openapi.yaml)

---

## License

MIT
