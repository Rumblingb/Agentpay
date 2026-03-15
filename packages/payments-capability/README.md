# @agentpay/payments-capability (v0.1)

Thin payments capability seam built on top of `@agentpay/sdk`.

Usage:

```ts
import AgentPayClient from '@agentpay/sdk';
import { enablePayments } from '@agentpay/payments-capability';

const client = AgentPayClient.fromEnv();
const payments = enablePayments(client);

await payments.pay({ amountUsdc: 1.0, recipientAddress: '...' });
```
