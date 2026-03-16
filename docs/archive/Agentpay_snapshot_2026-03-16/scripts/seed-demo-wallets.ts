/**
 * PRODUCTION FIX — DEMO FLOW
 *
 * Seeds the agentrank_scores table with three demo agent wallets so the
 * AgentRank flow is always populated for investor demos.
 *
 * Wallets:
 *   A — "The Good Agent"    (Score: 850, Grade: AAA)
 *   B — "The New Agent"     (Score: 300, Grade: C)
 *   C — "The Slashed Agent" (Score: 150, Grade: F)
 *
 * Usage:
 *   npx tsx scripts/seed-demo-wallets.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// PRODUCTION FIX — DEMO FLOW: Demo wallet definitions
const DEMO_WALLETS = [
  {
    agent_id: 'DemoAgentTrust850',
    score: 850,
    grade: 'AAA',
    payment_reliability: 0.97,
    service_delivery: 0.95,
    transaction_volume: 1200,
    wallet_age_days: 365,
    dispute_rate: 0.01,
    stake_usdc: 5000.0,
    unique_counterparties: 85,
  },
  {
    agent_id: 'DemoAgentNew300',
    score: 300,
    grade: 'C',
    payment_reliability: 0.55,
    service_delivery: 0.40,
    transaction_volume: 12,
    wallet_age_days: 7,
    dispute_rate: 0.15,
    stake_usdc: 50.0,
    unique_counterparties: 3,
  },
  {
    agent_id: 'DemoAgentSlash150',
    score: 150,
    grade: 'F',
    payment_reliability: 0.20,
    service_delivery: 0.10,
    transaction_volume: 45,
    wallet_age_days: 30,
    dispute_rate: 0.60,
    stake_usdc: 10.0,
    unique_counterparties: 2,
  },
];

async function main() {
  for (const wallet of DEMO_WALLETS) {
    const existing = await prisma.agentrank_scores.findUnique({
      where: { agent_id: wallet.agent_id },
    });

    if (existing) {
      // PRODUCTION FIX — DEMO FLOW: Update existing demo wallet to ensure correct values
      await prisma.agentrank_scores.update({
        where: { agent_id: wallet.agent_id },
        data: {
          score: wallet.score,
          grade: wallet.grade,
          payment_reliability: wallet.payment_reliability,
          service_delivery: wallet.service_delivery,
          transaction_volume: wallet.transaction_volume,
          wallet_age_days: wallet.wallet_age_days,
          dispute_rate: wallet.dispute_rate,
          stake_usdc: wallet.stake_usdc,
          unique_counterparties: wallet.unique_counterparties,
          updated_at: new Date(),
        },
      });
      console.log(
        `[SEED] Updated demo wallet: ${wallet.agent_id} (Score: ${wallet.score}, Grade: ${wallet.grade})`,
      );
    } else {
      await prisma.agentrank_scores.create({
        data: {
          agent_id: wallet.agent_id,
          score: wallet.score,
          grade: wallet.grade,
          payment_reliability: wallet.payment_reliability,
          service_delivery: wallet.service_delivery,
          transaction_volume: wallet.transaction_volume,
          wallet_age_days: wallet.wallet_age_days,
          dispute_rate: wallet.dispute_rate,
          stake_usdc: wallet.stake_usdc,
          unique_counterparties: wallet.unique_counterparties,
          factors: {},
          history: [],
        },
      });
      console.log(
        `[SEED] Created demo wallet: ${wallet.agent_id} (Score: ${wallet.score}, Grade: ${wallet.grade})`,
      );
    }
  }

  console.log('[SEED] All demo wallets seeded successfully.');
}

main()
  .catch((e) => {
    console.error('[SEED] Error seeding demo wallets:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
