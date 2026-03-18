/**
 * register-travel-agents.ts
 *
 * Registers 3 travel agents via the live AgentPay API.
 * These seed the tiered-choice demo in Meridian:
 *   - Budget:  TrainFinder         (£0.80, grade B, newer)
 *   - Balanced: RailSearch         ($2.10, grade A, verified)
 *   - Premium: EurostarConcierge   ($7.00, grade A+, human-backed)
 *
 * Usage:
 *   npx tsx scripts/register-travel-agents.ts
 *
 * Set API_BASE to override the endpoint (default: https://api.agentpay.so)
 */

const BASE        = process.env.API_BASE      ?? 'https://api.agentpay.so';
const WEBHOOK_BASE = process.env.WEBHOOK_BASE  ?? BASE;

interface RegisteredAgent {
  agentId: string;
  agentKey: string;
  passportUrl: string;
}

async function register(params: {
  name: string;
  description: string;
  category: string;
  capabilities: string[];
  pricePerTaskUsd: number;
  webhookUrl: string;
}): Promise<RegisteredAgent> {
  const res = await fetch(`${BASE}/api/v1/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...params,
      metadata: {
        source: 'seed_script',
        demo: true,
        tier: params.pricePerTaskUsd < 1.5 ? 'budget' : params.pricePerTaskUsd < 5 ? 'balanced' : 'premium',
      },
    }),
  });

  const data = await res.json() as any;
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as RegisteredAgent;
}

const MOCK_WEBHOOK = `${WEBHOOK_BASE}/api/mock/train-booking`;

const TRAVEL_AGENTS = [
  {
    name: 'TrainFinder',
    description: 'Finds budget train tickets across Eurostar, Amtrak, and national rail networks. Searches all classes, optimises for lowest fare.',
    category: 'travel',
    capabilities: ['train', 'rail', 'ticket', 'travel', 'booking', 'eurostar', 'search'],
    pricePerTaskUsd: 0.80,
    webhookUrl: MOCK_WEBHOOK,
  },
  {
    name: 'RailSearch',
    description: 'Verified rail booking agent with access to 40+ train operators. Books standard and flexible tickets, seat reservations included.',
    category: 'travel',
    capabilities: ['train', 'rail', 'ticket', 'travel', 'booking', 'seat', 'flexible', 'standard'],
    pricePerTaskUsd: 2.10,
    webhookUrl: MOCK_WEBHOOK,
  },
  {
    name: 'EurostarConcierge',
    description: 'Premium rail booking concierge — business class, lounge access, and human-assisted itinerary planning. Covers Eurostar, TGV, and intercity services.',
    category: 'travel',
    capabilities: ['train', 'rail', 'eurostar', 'tgv', 'business', 'premium', 'travel', 'concierge', 'lounge', 'booking'],
    pricePerTaskUsd: 7.00,
    webhookUrl: MOCK_WEBHOOK,
  },
];

async function main() {
  console.log(`[register-travel-agents] Registering 3 rail agents at ${BASE}\n`);

  for (const agent of TRAVEL_AGENTS) {
    try {
      const result = await register(agent);
      console.log(`[✓] ${agent.name}`);
      console.log(`    agentId:    ${result.agentId}`);
      console.log(`    agentKey:   ${result.agentKey}  ← save this`);
      console.log(`    passport:   ${result.passportUrl}`);
      console.log(`    price:      $${agent.pricePerTaskUsd.toFixed(2)}`);
      console.log();
    } catch (e: any) {
      console.error(`[✗] ${agent.name}: ${e.message}`);
    }
  }

  console.log('[register-travel-agents] Done.');
  console.log('Test match: POST /api/agents/match { "intent": "book a train to London" }');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
