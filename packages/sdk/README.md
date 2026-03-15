# @agentpay/sdk (v0 PR1)

Minimal AgentPay TypeScript SDK (PR1) implementing the locked v0 surface.

Quickstart

```ts
import AgentPayClient, { VerificationError } from '@agentpay/sdk';

// fromEnv() reads AGENTPAY_API_KEY (required) and AGENTPAY_BASE_URL (optional)
const client = AgentPayClient.fromEnv();

async function run() {
  try {
    const payment = await client.pay({ amountUsdc: 1.5, recipientAddress: 'recipient_wallet_address_here' });
    const verify = await client.verifyPayment(payment.id, '0xabc');
    console.log('verified', verify.verified);
  } catch (err) {
    if (err instanceof VerificationError) {
      console.error('verification failed', err.message);
    } else {
      throw err;
    }
  }
}

run();
```

This PR is intentionally minimal: it exposes `AgentPayClient` and the typed errors. It does not ship provider/framework exports or demo helpers.
