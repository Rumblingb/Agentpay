/**
 * Seed script — register the 4 constitutional foundation agents in the database.
 *
 * These are platform-owned agents that form the trust infrastructure of AgentPay.
 * They are seeded once and should never be duplicated.
 *
 * Usage:
 *   npx tsx scripts/seed-foundation-agents.ts
 *
 * Safe to re-run: uses upsert with fixed IDs. Existing records are updated, not replaced.
 *
 * Prerequisites:
 *   - DATABASE_URL (and optionally DIRECT_URL) set in .env
 *   - node scripts/migrate.js has been run (migration 030_foundation_agents)
 *
 * What this creates:
 *   4 rows in the `agents` table, one per constitutional agent.
 *   They appear in the public registry and in GET /api/foundation-agents.
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

// Fixed UUIDs so re-runs are idempotent. Never change these in production once set.
const FOUNDATION_AGENTS = [
  {
    id: '00000000-fa00-0000-0000-000000000001',
    displayName: 'IdentityVerifierAgent',
    service: 'constitutional-agent',
    endpointUrl: `${process.env.API_BASE_URL || 'http://localhost:3000'}/api/foundation-agents/identity`,
    pricingModel: {
      basic_verification: { amount: 10, currency: 'USD', description: 'Verify agent ownership and environment' },
      advanced_linking: { amount: 50, currency: 'USD', description: 'Cross-platform identity linking' },
    },
    rating: 5.0,
    operatorId: 'platform',
    trustScore: 100.0,
    description: 'Agent identity attestation & verification — constitutional layer #1',
  },
  {
    id: '00000000-fa00-0000-0000-000000000002',
    displayName: 'ReputationOracleAgent',
    service: 'constitutional-agent',
    endpointUrl: `${process.env.API_BASE_URL || 'http://localhost:3000'}/api/foundation-agents/reputation`,
    pricingModel: {
      basic_query: { amount: 1, currency: 'USD', description: 'Basic trust score lookup' },
      standard_query: { amount: 3, currency: 'USD', description: 'Standard reputation report' },
      comprehensive_query: { amount: 5, currency: 'USD', description: 'Full reputation analysis' },
      batch_lookup: { amount: 0.75, currency: 'USD', description: 'Per-agent batch pricing (up to 10)' },
    },
    rating: 5.0,
    operatorId: 'platform',
    trustScore: 100.0,
    description: 'Trust score queries from the reputation graph — constitutional layer #2',
  },
  {
    id: '00000000-fa00-0000-0000-000000000003',
    displayName: 'DisputeResolverAgent',
    service: 'constitutional-agent',
    endpointUrl: `${process.env.API_BASE_URL || 'http://localhost:3000'}/api/foundation-agents/dispute`,
    pricingModel: {
      small_dispute: { amount: 50, currency: 'USD', description: 'Disputes on transactions < $100' },
      medium_dispute: { amount: 100, currency: 'USD', description: 'Disputes on transactions $100–$1k' },
      large_dispute: { amount: 250, currency: 'USD', description: 'Disputes on transactions $1k–$10k' },
      enterprise_dispute: { amount: 500, currency: 'USD', description: 'Disputes on transactions > $10k' },
    },
    rating: 5.0,
    operatorId: 'platform',
    trustScore: 100.0,
    description: 'Structured dispute resolution for agent transactions — constitutional layer #3',
  },
  {
    id: '00000000-fa00-0000-0000-000000000004',
    displayName: 'IntentCoordinatorAgent',
    service: 'constitutional-agent',
    endpointUrl: `${process.env.API_BASE_URL || 'http://localhost:3000'}/api/foundation-agents/intent`,
    pricingModel: {
      instant_routing: { amount: 1.00, currency: 'USD', description: 'Stripe/Solana routing' },
      fast_routing: { amount: 0.50, currency: 'USD', description: 'x402 routing' },
      standard_routing: { amount: 0.25, currency: 'USD', description: 'Bank/ACH routing' },
    },
    rating: 5.0,
    operatorId: 'platform',
    trustScore: 100.0,
    description: 'Multi-protocol transaction routing & coordination — constitutional layer #4',
  },
] as const;

async function main() {
  console.log('[seed-foundation-agents] Starting...\n');

  for (const agent of FOUNDATION_AGENTS) {
    const { description, ...data } = agent;

    const result = await prisma.agent.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        displayName: data.displayName,
        service: data.service,
        endpointUrl: data.endpointUrl,
        pricingModel: data.pricingModel,
        rating: data.rating,
        operatorId: data.operatorId,
        trustScore: data.trustScore,
      },
      update: {
        displayName: data.displayName,
        service: data.service,
        endpointUrl: data.endpointUrl,
        pricingModel: data.pricingModel,
        rating: data.rating,
        operatorId: data.operatorId,
        trustScore: data.trustScore,
      },
    });

    console.log(`[✓] ${data.displayName}`);
    console.log(`    id:       ${result.id}`);
    console.log(`    endpoint: ${result.endpointUrl}`);
    console.log(`    service:  ${result.service}`);
    console.log(`    note:     ${description}`);
    console.log();
  }

  console.log('[seed-foundation-agents] Done. All 4 constitutional agents are registered.\n');
  console.log('Next steps:');
  console.log('  - View them in the registry:   GET /api/agents/leaderboard');
  console.log('  - Inspect an agent:            GET /api/agents/<id>');
  console.log('  - Discover foundation agents:  GET /api/foundation-agents');
  console.log('  - CLI:                         agentpay foundation list');
}

main()
  .catch((e) => {
    console.error('[seed-foundation-agents] Error:', e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
