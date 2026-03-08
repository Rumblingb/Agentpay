/**
 * AgentPay SDK — Example: Autonomous Agent paying for Weather Data
 *
 * This script demonstrates how an AI agent can pay for an API service
 * with just 3 lines of business logic.
 *
 * Usage:
 *   AGENTPAY_API_KEY=sk_live_xxx AGENTPAY_BASE_URL=https://api.agentpay.io \
 *     npx ts-node src/example.ts
 */

import { AgentPay } from './index.js';

const agentpay = new AgentPay({
  baseUrl: process.env.AGENTPAY_BASE_URL ?? 'http://localhost:3001',
  apiKey: process.env.AGENTPAY_API_KEY ?? '',
});

// Agent autonomously pays for a Weather Data Request
const payment = await agentpay.pay({
  amount: 0.01,
  currency: 'USDC',
  recipient: 'WeatherDataAPI',
  metadata: { service: 'weather-forecast', query: 'San Francisco, CA' },
});

console.log('Payment intent created:', payment.intentId);
console.log('Solana Pay URI:', payment.solanaPayUri);
console.log('Status:', payment.status);

// In a real workflow the agent would watch for on-chain confirmation:
// const result = await agentpay.verify(payment.intentId);
// console.log('Confirmed:', result.status);
