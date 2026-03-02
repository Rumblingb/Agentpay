/**
 * Spending Policy Service
 *
 * Enforces daily spending limits for agents at specific merchants.
 * Uses a database transaction to atomically check the total USDC spent
 * in the last 24 hours and determine whether a new transaction is allowed.
 */

import { query, getClient } from '../db/index';
import { logger } from '../logger';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SpendingPolicyRow {
  id: string;
  merchant_id: string;
  agent_id: string;
  daily_limit: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface SpendingCheckResult {
  allowed: boolean;
  spentToday: number;
  dailyLimit: number;
  remaining: number;
  reason?: string;
}

// ── Schema Bootstrap ───────────────────────────────────────────────────────

/**
 * Creates the spending_policies table if it does not already exist.
 * Called during server initialisation or the first time the service is used.
 */
export async function ensureSpendingPoliciesTable(): Promise<void> {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS spending_policies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        agent_id VARCHAR(255) NOT NULL,
        daily_limit DECIMAL(20, 6) NOT NULL DEFAULT 100.00,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_spending_policy UNIQUE (merchant_id, agent_id)
      );

      CREATE INDEX IF NOT EXISTS idx_spending_policies_merchant_id
        ON spending_policies(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_spending_policies_agent_id
        ON spending_policies(agent_id);
      CREATE INDEX IF NOT EXISTS idx_spending_policies_active
        ON spending_policies(active);
    `);
  } catch (err) {
    logger.error('Failed to bootstrap spending_policies table', { err });
  }
}

// ── Core Logic ─────────────────────────────────────────────────────────────

/**
 * Checks whether an agent is allowed to spend `amount` at a given merchant
 * based on its daily spending policy.
 *
 * Algorithm:
 *   1. Look up the active spending policy for (agentId, merchantId).
 *   2. If no policy exists, the transaction is allowed (no cap).
 *   3. Sum all USDC amounts for verified payment intents created in the
 *      last 24 hours by that agent at that merchant.
 *   4. If (spentToday + amount) > dailyLimit, reject with 429.
 *
 * The lookup uses an index on (merchant_id, created_at) for performance.
 */
export async function checkAndIncrementSpending(
  agentId: string,
  merchantId: string,
  amount: number,
): Promise<SpendingCheckResult> {
  // 1. Fetch the active policy
  const policyResult = await query(
    `SELECT id, daily_limit
     FROM spending_policies
     WHERE merchant_id = $1 AND agent_id = $2 AND active = true
     LIMIT 1`,
    [merchantId, agentId],
  );

  // No policy → allow by default
  if (policyResult.rows.length === 0) {
    return {
      allowed: true,
      spentToday: 0,
      dailyLimit: Infinity,
      remaining: Infinity,
    };
  }

  const dailyLimit = Number(policyResult.rows[0].daily_limit);

  // 2. Calculate total spending in the last 24 hours using a transaction
  //    for consistency (prevents TOCTOU race conditions).
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const spendResult = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_spent
       FROM payment_intents
       WHERE merchant_id = $1
         AND metadata->>'agentId' = $2
         AND created_at >= NOW() - INTERVAL '24 hours'
         AND status NOT IN ('expired', 'failed')`,
      [merchantId, agentId],
    );

    const spentToday = Number(spendResult.rows[0].total_spent);
    const remaining = dailyLimit - spentToday;

    await client.query('COMMIT');

    if (spentToday + amount > dailyLimit) {
      logger.warn('Spending policy limit reached', {
        agentId,
        merchantId,
        spentToday,
        dailyLimit,
        requestedAmount: amount,
      });

      return {
        allowed: false,
        spentToday,
        dailyLimit,
        remaining: Math.max(0, remaining),
        reason: `Daily spending limit reached. Spent today: ${spentToday.toFixed(2)} USDC, limit: ${dailyLimit.toFixed(2)} USDC.`,
      };
    }

    return {
      allowed: true,
      spentToday,
      dailyLimit,
      remaining: remaining - amount,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── CRUD Helpers ───────────────────────────────────────────────────────────

export async function getSpendingPolicy(
  agentId: string,
  merchantId: string,
): Promise<SpendingPolicyRow | null> {
  const result = await query(
    `SELECT * FROM spending_policies WHERE merchant_id = $1 AND agent_id = $2 LIMIT 1`,
    [merchantId, agentId],
  );
  return result.rows[0] ?? null;
}

export async function upsertSpendingPolicy(
  merchantId: string,
  agentId: string,
  dailyLimit: number,
  active = true,
): Promise<SpendingPolicyRow> {
  const result = await query(
    `INSERT INTO spending_policies (merchant_id, agent_id, daily_limit, active)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (merchant_id, agent_id) DO UPDATE
       SET daily_limit = EXCLUDED.daily_limit,
           active = EXCLUDED.active,
           updated_at = NOW()
     RETURNING *`,
    [merchantId, agentId, dailyLimit, active],
  );
  return result.rows[0];
}

export default {
  ensureSpendingPoliciesTable,
  checkAndIncrementSpending,
  getSpendingPolicy,
  upsertSpendingPolicy,
};
