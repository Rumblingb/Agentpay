/**
 * PRODUCTION FIX — INSURANCE TRIGGER LOGIC
 *
 * Extends the Behavioral Oracle to trigger insurance payouts from the
 * insurance_pool when a critical alert fires. Workflow:
 *
 *   1. Slash the agent's AgentRank score by a configurable penalty.
 *   2. Look up the insurance pool and compute the payout (capped by
 *      max_coverage_per_tx and the remaining pool balance).
 *   3. Decrement the pool and increment total_claims.
 *
 * This module is intentionally kept separate from behavioral-oracle.ts so
 * the existing pure-function detection logic stays untouched (additive only).
 *
 * @module insurance-trigger
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of processing a critical alert with insurance. */
export interface InsuranceClaimResult {
  agentId: string;
  escrowId: string;
  reputationSlashed: number;
  payoutUsdc: number;
  poolRemainingUsdc: number;
  claimNumber: number;
}

/** Minimal pool record (mirrors Prisma insurance_pool shape). */
export interface InsurancePoolRecord {
  id: number;
  current_balance_usdc: number;
  max_coverage_per_tx: number;
  total_claims: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default reputation penalty applied on a critical alert. */
export const DEFAULT_REPUTATION_SLASH = 50;

// ---------------------------------------------------------------------------
// Core logic (pure — no DB dependency for testability)
// ---------------------------------------------------------------------------

/**
 * Compute the insurance payout for a critical alert.
 *
 * The payout is the lesser of `max_coverage_per_tx` and the remaining pool
 * balance — i.e. the pool never goes negative.
 */
export function computePayout(pool: InsurancePoolRecord): number {
  if (pool.current_balance_usdc <= 0) return 0;
  return Math.min(
    Number(pool.max_coverage_per_tx),
    Number(pool.current_balance_usdc),
  );
}

/**
 * Process a critical alert against a given pool (pure function).
 *
 * Returns the claim result without persisting — callers are responsible for
 * writing the updated pool back to the database.
 */
export function processCriticalAlertPure(
  agentId: string,
  escrowId: string,
  pool: InsurancePoolRecord,
  reputationSlash: number = DEFAULT_REPUTATION_SLASH,
): InsuranceClaimResult {
  const payout = computePayout(pool);
  return {
    agentId,
    escrowId,
    reputationSlashed: reputationSlash,
    payoutUsdc: payout,
    poolRemainingUsdc: Number(pool.current_balance_usdc) - payout,
    claimNumber: pool.total_claims + 1,
  };
}
