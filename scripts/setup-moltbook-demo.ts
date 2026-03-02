/**
 * @file setup-moltbook-demo.ts
 * @purpose Creates a realistic demo environment for Moltbook integration presentations
 *
 * Creates 3 demo bots with different spending patterns, pre-populates transactions,
 * and sets up spending policies and reputation history.
 *
 * Run: npx tsx scripts/setup-moltbook-demo.ts
 */

import { randomUUID } from 'crypto';

const API_BASE = process.env.API_URL || 'http://localhost:3001';
const API_KEY = process.env.API_KEY || 'sk_test_sim_12345';

const MERCHANTS = [
  'OpenAI API', 'Anthropic API', 'Pinecone', 'Serper', 'Cohere',
  'Replicate', 'Hugging Face', 'AWS Bedrock', 'Google Vertex AI', 'Stability AI',
];

interface DemoBot {
  handle: string;
  displayName: string;
  bio: string;
  primaryFunction: string;
  policy: { dailySpendingLimit: number; perTxLimit: number; autoApproveUnder: number };
  txPattern: 'high-frequency' | 'bursty' | 'steady';
}

const DEMO_BOTS: DemoBot[] = [
  {
    handle: '@HighFrequencyBot',
    displayName: 'High Frequency Bot',
    bio: 'Makes many small API calls across multiple services',
    primaryFunction: 'research-agent',
    policy: { dailySpendingLimit: 50, perTxLimit: 5, autoApproveUnder: 1 },
    txPattern: 'high-frequency',
  },
  {
    handle: '@BurstyBot',
    displayName: 'Bursty Bot',
    bio: 'Occasionally makes large purchases for compute-intensive tasks',
    primaryFunction: 'compute-agent',
    policy: { dailySpendingLimit: 200, perTxLimit: 50, autoApproveUnder: 5 },
    txPattern: 'bursty',
  },
  {
    handle: '@SteadyBot',
    displayName: 'Steady Bot',
    bio: 'Consistent daily spending on monitoring and data services',
    primaryFunction: 'monitoring-agent',
    policy: { dailySpendingLimit: 25, perTxLimit: 10, autoApproveUnder: 2 },
    txPattern: 'steady',
  },
];

async function apiCall(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn(`  ⚠ ${method} ${path} → ${res.status}: ${text}`);
    return null;
  }
  return res.json();
}

function generateAmount(pattern: DemoBot['txPattern']): number {
  switch (pattern) {
    case 'high-frequency':
      return +(Math.random() * 0.5 + 0.1).toFixed(2); // $0.10 - $0.60
    case 'bursty':
      return Math.random() > 0.7
        ? +(Math.random() * 40 + 10).toFixed(2) // 30% chance of $10-$50
        : +(Math.random() * 2 + 0.5).toFixed(2); // 70% chance of $0.50-$2.50
    case 'steady':
      return +(Math.random() * 3 + 1).toFixed(2); // $1.00 - $4.00
  }
}

function generateTxCount(pattern: DemoBot['txPattern']): number {
  switch (pattern) {
    case 'high-frequency': return Math.floor(Math.random() * 15 + 10); // 10-25 per day
    case 'bursty': return Math.floor(Math.random() * 5 + 1); // 1-5 per day
    case 'steady': return Math.floor(Math.random() * 3 + 3); // 3-5 per day
  }
}

async function main() {
  console.log('🚀 Setting up Moltbook demo environment...\n');

  for (const bot of DEMO_BOTS) {
    console.log(`📦 Registering ${bot.handle}...`);

    // Register bot
    const result = await apiCall('POST', '/api/moltbook/bots/register', {
      handle: bot.handle,
      display_name: bot.displayName,
      bio: bot.bio,
      primary_function: bot.primaryFunction,
    });

    if (!result) {
      console.log(`  ⚠ Bot may already exist, continuing...\n`);
    } else {
      console.log(`  ✅ Registered successfully`);
    }

    // Update spending policy
    console.log(`  📋 Setting spending policy...`);
    await apiCall('PATCH', `/api/moltbook/bots/${bot.handle}/spending-policy`, bot.policy);

    // Simulate payments
    const txCount = generateTxCount(bot.txPattern) * 5; // ~5 days worth
    console.log(`  💳 Simulating ${txCount} transactions...`);

    for (let i = 0; i < txCount; i++) {
      const merchant = MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)];
      const amount = generateAmount(bot.txPattern);

      await apiCall('POST', '/api/moltbook/demo/simulate-payment', {
        handle: bot.handle,
        merchantName: merchant,
        amount,
      });
    }

    console.log(`  ✅ Done\n`);
  }

  console.log('🎉 Demo environment ready!');
  console.log('\nView dashboards at:');
  for (const bot of DEMO_BOTS) {
    console.log(`  → http://localhost:3000/moltbook/${encodeURIComponent(bot.handle)}`);
  }
  console.log('\nAPI endpoints:');
  for (const bot of DEMO_BOTS) {
    console.log(`  → GET /api/moltbook/bots/${bot.handle}/spending`);
    console.log(`  → GET /api/moltbook/bots/${bot.handle}/analytics`);
  }
}

main().catch(console.error);
