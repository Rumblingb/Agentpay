Agent SDK (minimal)

Example: spawn a demo agent and run a demo transaction

```ts
import { Agent } from './src/agent';

const cfg = { baseUrl: 'http://localhost:3002', apiKey: process.env.AGENTPAY_API_KEY, timeoutMs: 5000 };

(async () => {
  const res = await Agent.spawn(cfg, { displayName: 'DemoAgent', service: 'FlightAgent' });
  console.log('Spawn result:', res);
  // res.receiptSvg contains a quick visual receipt for demos
})();
```

This is intentionally minimal — the SDK provides convenience helpers for demo flows.
# @agentpayxyz/sdk

JavaScript/TypeScript SDK for [AgentPay](https://agentpay.gg) — the universal payment gateway for AI agents.

See [docs/sdk/js.md](../../docs/sdk/js.md) for full documentation.

## Quick install

```bash
npm install @agentpayxyz/sdk
```
