/**
 * PRODUCTION FIX — INSURANCE POOL SEED SCRIPT
 *
 * Seeds the insurance_pool table with an initial 10 000 USDC balance.
 * This pool backstops the Behavioral Oracle: when a critical alert fires
 * the system can automatically pay out up to $100 per claim.
 *
 * Usage:
 *   npx tsx scripts/seed-insurance-pool.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.insurance_pool.findFirst();

  if (existing) {
    console.log(
      `[SEED] Insurance pool already exists (id=${existing.id}, balance=${existing.current_balance_usdc} USDC). Skipping.`,
    );
    return;
  }

  const pool = await prisma.insurance_pool.create({
    data: {
      current_balance_usdc: 10_000.0,
      max_coverage_per_tx: 100.0,
      total_claims: 0,
    },
  });

  console.log(
    `[SEED] Insurance pool created — id=${pool.id}, balance=${pool.current_balance_usdc} USDC`,
  );
}

main()
  .catch((e) => {
    console.error('[SEED] Error seeding insurance pool:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
