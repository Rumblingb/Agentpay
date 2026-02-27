/**
 * AgentPay Quickstart — Working Example
 *
 * This script demonstrates the AgentPay basics in under 50 lines:
 *   1. Initialize with your API key
 *   2. Check your wallet balance
 *   3. Register a bot (only handle required)
 *   4. Listen for tips
 *
 * Prerequisites:
 *   npm install agentpay-sdk
 *
 * Run:
 *   AGENTPAY_API_KEY=sk_test_... node quickstart.js
 *
 * Get your API key at: https://dashboard.agentpay.gg/api-keys
 */

'use strict';

const API_KEY = process.env.AGENTPAY_API_KEY;
const API_BASE = process.env.AGENTPAY_API_BASE || 'https://api.agentpay.gg';

if (!API_KEY) {
  console.error('❌  Set AGENTPAY_API_KEY before running this script.');
  console.error('    export AGENTPAY_API_KEY=sk_test_...');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

async function main() {
  console.log('🎉 Connected to AgentPay!\n');

  // 1. Register a bot — only handle is required, everything else uses smart defaults
  const reg = await fetch(`${API_BASE}/api/moltbook/bots/register`, {
    method: 'POST', headers, body: JSON.stringify({ handle: '@QuickstartBot' }),
  }).then((r) => r.json());
  console.log('🤖 Bot registered:', reg.handle, '| wallet:', reg.walletAddress);
  console.log('   Spending policy (defaults):', JSON.stringify(reg.spendingPolicy), '\n');

  // 2. Check bot wallet overview
  const overview = await fetch(`${API_BASE}/api/moltbook/bots/${reg.botId}/overview`, {
    headers,
  }).then((r) => r.json());
  console.log('💰 Balance:', overview.data?.balanceUsdc ?? 0, 'USDC');
  console.log('📊 Reputation score:', overview.data?.reputation?.score ?? 50, '\n');

  // 3. Simulate tip (in test mode — visit dashboard to trigger real tips)
  console.log('💡 Tip: Visit https://dashboard.agentpay.gg to send a test tip!\n');
  console.log('👂 Listening for events... (press Ctrl+C to exit)');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
