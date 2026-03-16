/**
 * Liquidity Engine — Seed Market Maker for the AgentPay marketplace.
 *
 * Every 5 minutes:
 *   1. Spawns 3 dummy buyer agents (if they don't already exist)
 *   2. Creates 5 micro jobs (0.01 USDC each) via escrowService
 *   3. Auto-completes them after 30s (demo mode)
 *   4. Logs everything under "liquidity-bot" tag for easy prod filtering
 *
 * Uses the existing BullMQ / setTimeout pattern (no extra queue needed for demo).
 * In production wire this into a BullMQ repeating job.
 *
 * @module services/liquidityService
 */

import { logger } from '../logger.js';
import { randomInt } from 'crypto';
import escrowService from './escrowService.js';
import { emitJobCreated, emitEscrowReleased } from '../events/marketplaceEmitter.js';
import prisma from '../lib/prisma.js';
import * as agentrankService from './agentrankService.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIQUIDITY_TAG = 'liquidity-bot';
const MICRO_JOB_AMOUNT = 0.01; // USDC
const AUTO_COMPLETE_MS = 30_000; // 30 seconds
const CRON_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const BUYER_SEEDS = [
  { id: 'liquidity-buyer-alpha', name: 'LiquidityBuyer-α' },
  { id: 'liquidity-buyer-beta',  name: 'LiquidityBuyer-β' },
  { id: 'liquidity-buyer-gamma', name: 'LiquidityBuyer-γ' },
];

const MICRO_JOB_DESCRIPTIONS = [
  'Price feed lookup',
  'Token balance check',
  'Latency probe',
  'Health ping',
  'Micro compute task',
];

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let cronHandle: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Ensure dummy buyer agents exist in the DB.
 * Idempotent — skips if they already exist.
 */
async function ensureLiquidityAgents(): Promise<void> {
  for (const seed of BUYER_SEEDS) {
    try {
      const existing = await prisma.agent.findFirst({
        where: { id: seed.id },
        select: { id: true },
      });
      if (!existing) {
        await prisma.agent.create({
          data: {
            id: seed.id,
            displayName: seed.name,
            service: 'liquidity',
            endpointUrl: 'https://liquidity.agentpay.internal',
            pricingModel: { perTask: MICRO_JOB_AMOUNT } as any,
            rating: 5.0,
            totalEarnings: 0,
            tasksCompleted: 0,
          } as any,
        });
        logger.info(`[${LIQUIDITY_TAG}] Created liquidity agent`, { id: seed.id });
      }
    } catch {
      // Ignore — agent may already exist or schema mismatch
    }
  }
}

/**
 * Pick a random element from an array.
 */
function randomPick<T>(arr: T[]): T {
  return arr[randomInt(arr.length)];
}

/**
 * Create one micro job: escrow → auto-complete → release → emit events.
 */
async function createMicroJob(buyerSeed: { id: string }): Promise<void> {
  const seller = randomPick(BUYER_SEEDS.filter((s) => s.id !== buyerSeed.id));
  const description = randomPick(MICRO_JOB_DESCRIPTIONS);

  let escrowRecord: Awaited<ReturnType<typeof escrowService.create>> | null = null;

  try {
    escrowRecord = await escrowService.create({
      type: 'internal',
      fromAgentId: buyerSeed.id,
      toAgentId: seller.id,
      amount: MICRO_JOB_AMOUNT,
      taskDescription: `[${LIQUIDITY_TAG}] ${description}`,
      timeoutHours: 1,
    });

    logger.info(`[${LIQUIDITY_TAG}] Micro job created`, {
      escrowId: escrowRecord.escrowId,
      buyer: buyerSeed.id,
      seller: seller.id,
      description,
    });

    emitJobCreated(seller.id, `[${LIQUIDITY_TAG}] ${description}`, MICRO_JOB_AMOUNT);

    // Persist to AgentTransaction
    try {
      await (prisma as any).agentTransaction.create({
        data: {
          buyerAgentId: buyerSeed.id,
          sellerAgentId: seller.id,
          task: { description, tag: LIQUIDITY_TAG },
          status: 'pending',
          amount: MICRO_JOB_AMOUNT,
          escrowId: escrowRecord.escrowId,
        },
      });
    } catch {
      // Table may not exist yet
    }

    // Auto-complete after 30s
    const eid = escrowRecord.escrowId;
    setTimeout(async () => {
      try {
        await escrowService.release(eid, buyerSeed.id);
        emitEscrowReleased(eid, seller.id, MICRO_JOB_AMOUNT);

        // +10 AgentRank for seller
        await agentrankService.adjustScore(seller.id, 10, 'escrow_release', `[${LIQUIDITY_TAG}] auto-release`);

        // Update AgentTransaction status
        try {
          await (prisma as any).agentTransaction.updateMany({
            where: { escrowId: eid },
            data: { status: 'completed' },
          });
        } catch {
          // Ignore
        }

        logger.info(`[${LIQUIDITY_TAG}] Micro job auto-released`, { escrowId: eid });
      } catch (err: any) {
        logger.warn(`[${LIQUIDITY_TAG}] Auto-release failed`, { err: err?.message, escrowId: eid });
      }
    }, AUTO_COMPLETE_MS);
  } catch (err: any) {
    logger.warn(`[${LIQUIDITY_TAG}] Micro job creation failed`, { err: err?.message });
  }
}

/**
 * Run one liquidity cycle: ensure agents exist, create 5 micro jobs.
 */
export async function runLiquidityCycle(): Promise<void> {
  if (isRunning) {
    logger.debug(`[${LIQUIDITY_TAG}] Cycle already running, skipping`);
    return;
  }
  isRunning = true;

  try {
    logger.info(`[${LIQUIDITY_TAG}] Starting liquidity cycle`);
    await ensureLiquidityAgents();

    for (let i = 0; i < 5; i++) {
      const buyer = BUYER_SEEDS[i % BUYER_SEEDS.length];
      await createMicroJob(buyer);
    }

    logger.info(`[${LIQUIDITY_TAG}] Cycle complete — 5 micro jobs created`);
  } catch (err: any) {
    logger.error(`[${LIQUIDITY_TAG}] Cycle error`, { err: err?.message });
  } finally {
    isRunning = false;
  }
}

/**
 * Start the liquidity cron job (runs every 5 minutes).
 * Safe to call multiple times — no-ops if already started.
 */
export function startLiquidityCron(): void {
  if (cronHandle) return;

  logger.info(`[${LIQUIDITY_TAG}] Starting liquidity cron (interval: ${CRON_INTERVAL_MS / 1000}s)`);

  // Run once immediately on startup (in background, don't block)
  Promise.resolve().then(() => runLiquidityCycle().catch(() => {}));

  cronHandle = setInterval(() => {
    runLiquidityCycle().catch(() => {});
  }, CRON_INTERVAL_MS);

  // Don't keep process alive just for this cron (Node.js-specific: unref if available)
  if (typeof (cronHandle as any).unref === 'function') (cronHandle as any).unref();
}

/**
 * Stop the liquidity cron job.
 */
export function stopLiquidityCron(): void {
  if (cronHandle) {
    clearInterval(cronHandle);
    cronHandle = null;
    logger.info(`[${LIQUIDITY_TAG}] Cron stopped`);
  }
}
