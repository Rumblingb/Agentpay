# Quickstart — Developer Happy Path

This quickstart focuses on the PR7 developer happy path: creating a payment
and verifying it via the Worker `verify` endpoint using `txHash`.

1. Install dependencies

```bash
npm ci
```

2. Start the local development services (requires Docker/Postgres for DB)

```bash
npm run dev
```

3. Run the minimal first-payment example

The example `examples/simple-payment.ts` demonstrates the create-payment → verify flow.

4. Verify a payment

Use the Worker `GET /api/verify/:txHash` endpoint and provide the `txHash` from
the payment to receive the canonical receipt payload.

See `INTEGRATION_GUIDE.md` and `docs/INDEX.md` for full integration notes.

## Semi-live demo

A minimal, in-repo semi-live demo simulates the AgentPay adapter and runs a
full create→policy→verify flow without external services.

Run it with:

```bash
npm install
npx tsx examples/adapters/semiLiveDemo.ts
```

This script is intentionally self-contained and uses an in-memory sandbox
client so it does not require Postgres/Prisma/Solana/Stripe.
