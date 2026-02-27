/**
 * Example: Node.js backend agent using AgentPay Protocol V1
 *
 * Prerequisites:
 *   npm install node-fetch   (or use built-in fetch in Node 18+)
 *
 * Usage:
 *   AGENTPAY_BASE_URL=http://localhost:3001 node index.js
 */

const BASE_URL = process.env.AGENTPAY_BASE_URL || 'http://localhost:3001';

async function apiPost(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  return res.json();
}

async function main() {
  // 1. Register agent
  const { data: agent } = await apiPost('/api/agents/register', {
    pin: '123456',
    spendingLimit: 100,
  });
  console.log('Registered agent:', agent.agentId);

  // 2. Create a payment intent (with PIN for human authorization)
  const intent = await apiPost('/api/v1/payment-intents', {
    merchantId: process.env.MERCHANT_ID || '00000000-0000-0000-0000-000000000000',
    agentId: agent.agentId,
    amount: 1.00,
    currency: 'USDC',
    pin: '123456',
  });
  console.log('Payment intent:', intent.intentId);
  console.log('Send USDC to:', intent.instructions?.crypto?.recipientAddress);
  console.log('Memo:', intent.instructions?.crypto?.memo);

  // 3. Poll for verification
  let attempts = 0;
  while (attempts < 10) {
    const status = await apiGet(`/api/v1/payment-intents/${intent.intentId}`);
    console.log('Status:', status.status);
    if (status.status === 'verified') {
      console.log('Payment verified!');
      break;
    }
    if (status.status === 'expired' || status.status === 'failed') {
      console.log('Payment failed:', status.status);
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
    attempts++;
  }
}

main().catch(console.error);
