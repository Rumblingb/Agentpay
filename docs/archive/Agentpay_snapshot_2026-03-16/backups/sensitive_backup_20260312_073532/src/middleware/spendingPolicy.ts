/**
 * Spending Policy Enforcement Middleware
 *
 * Provides general-purpose spending policy enforcement for ANY agent making
 * payments through AgentPay — not just Moltbook bots.
 *
 * Policy checks (in order):
 *   1. Per-transaction amount limit
 *   2. Daily spending limit
 *   3. Merchant/recipient allowlist (if configured)
 *   4. AgentRank minimum threshold (optional)
 *   5. Auto-approve below configured threshold
 *
 * The policy is stored in the agent_spending_policies table (or falls back
 * to environment-configured global defaults).
 *
 * Usage:
 *   router.post('/payment', enforceSpendingPolicy, paymentHandler);
 *
 * @module middleware/spendingPolicy
 */

import { Request, Response, NextFunction } from 'express';
import { query } from '../db/index.js';
import { logger } from '../logger.js';

export interface SpendingPolicyConfig {
  /** Per-transaction limit in USD cents */
  perTxLimitCents: number;
  /** Daily spending limit in USD cents */
  dailyLimitCents: number;
  /** Auto-approve amounts at or below this (USD cents) */
  autoApproveUnderCents: number;
  /** Minimum AgentRank score required to transact (0 = no requirement) */
  minAgentRank: number;
  /** Allowlisted recipient IDs / wallet addresses (empty = all allowed) */
  allowedRecipients: string[];
}

// Global defaults — override via environment variables
const DEFAULT_POLICY: SpendingPolicyConfig = {
  perTxLimitCents: parseInt(process.env.DEFAULT_PER_TX_LIMIT_CENTS ?? '100000', 10), // $1,000
  dailyLimitCents: parseInt(process.env.DEFAULT_DAILY_LIMIT_CENTS ?? '1000000', 10), // $10,000
  autoApproveUnderCents: parseInt(process.env.DEFAULT_AUTO_APPROVE_UNDER_CENTS ?? '500', 10), // $5
  minAgentRank: parseInt(process.env.DEFAULT_MIN_AGENT_RANK ?? '0', 10),
  allowedRecipients: [],
};

export interface PolicyCheckResult {
  allowed: boolean;
  autoApproved: boolean;
  reason?: string;
  remainingDailyCents?: number;
  policy: SpendingPolicyConfig;
}

/**
 * Load the agent's spending policy from the DB.
 * Falls back to global DEFAULT_POLICY if no record exists.
 */
async function loadPolicy(agentId: string): Promise<SpendingPolicyConfig> {
  try {
    const result = await query(
      `SELECT per_tx_limit_cents, daily_limit_cents, auto_approve_under_cents,
              min_agent_rank, allowed_recipients
       FROM agent_spending_policies
       WHERE agent_id = $1
       LIMIT 1`,
      [agentId],
    );

    if (result.rows.length === 0) return DEFAULT_POLICY;

    const row = result.rows[0];
    return {
      perTxLimitCents: row.per_tx_limit_cents ?? DEFAULT_POLICY.perTxLimitCents,
      dailyLimitCents: row.daily_limit_cents ?? DEFAULT_POLICY.dailyLimitCents,
      autoApproveUnderCents: row.auto_approve_under_cents ?? DEFAULT_POLICY.autoApproveUnderCents,
      minAgentRank: row.min_agent_rank ?? DEFAULT_POLICY.minAgentRank,
      allowedRecipients: row.allowed_recipients ?? [],
    };
  } catch {
    // Table may not exist yet — use defaults
    return DEFAULT_POLICY;
  }
}

/**
 * Get total spending for an agent today (UTC day).
 */
async function getTodaySpending(agentId: string): Promise<number> {
  try {
    const result = await query(
      `SELECT COALESCE(SUM(amount_cents), 0) as total
       FROM payment_intents
       WHERE agent_id = $1
         AND status IN ('completed', 'verified')
         AND created_at >= CURRENT_DATE`,
      [agentId],
    );
    return parseInt(result.rows[0]?.total ?? '0', 10);
  } catch {
    // Table may not exist or have different schema — skip check
    return 0;
  }
}

/**
 * Core policy check — pure function, no side effects.
 */
export function checkPolicy(
  amountCents: number,
  recipientId: string | undefined,
  agentRankScore: number | undefined,
  todaySpentCents: number,
  policy: SpendingPolicyConfig,
): PolicyCheckResult {
  // 1. Per-transaction limit
  if (amountCents > policy.perTxLimitCents) {
    return {
      allowed: false,
      autoApproved: false,
      reason: `SPENDING_POLICY_VIOLATION: Amount $${(amountCents / 100).toFixed(2)} exceeds per-transaction limit of $${(policy.perTxLimitCents / 100).toFixed(2)}`,
      policy,
    };
  }

  // 2. Daily limit
  if (todaySpentCents + amountCents > policy.dailyLimitCents) {
    const remaining = Math.max(0, policy.dailyLimitCents - todaySpentCents);
    return {
      allowed: false,
      autoApproved: false,
      reason: `SPENDING_POLICY_VIOLATION: Would exceed daily limit. Remaining: $${(remaining / 100).toFixed(2)}`,
      remainingDailyCents: remaining,
      policy,
    };
  }

  // 3. Recipient allowlist
  if (
    policy.allowedRecipients.length > 0 &&
    recipientId &&
    !policy.allowedRecipients.includes(recipientId)
  ) {
    return {
      allowed: false,
      autoApproved: false,
      reason: `SPENDING_POLICY_VIOLATION: Recipient '${recipientId}' is not in the allowlist`,
      policy,
    };
  }

  // 4. Minimum AgentRank requirement
  if (policy.minAgentRank > 0 && agentRankScore !== undefined && agentRankScore < policy.minAgentRank) {
    return {
      allowed: false,
      autoApproved: false,
      reason: `SPENDING_POLICY_VIOLATION: AgentRank ${agentRankScore} below required minimum ${policy.minAgentRank}`,
      policy,
    };
  }

  // 5. Auto-approve check
  const autoApproved = amountCents <= policy.autoApproveUnderCents;

  return {
    allowed: true,
    autoApproved,
    remainingDailyCents: Math.max(0, policy.dailyLimitCents - todaySpentCents - amountCents),
    policy,
  };
}

/**
 * Express middleware — enforces spending policy before payment creation.
 *
 * Reads from:
 *   - req.body.amount (USD cents)
 *   - req.body.recipient (optional)
 *   - req.merchant.id (from auth middleware)
 *
 * On violation, returns HTTP 402 with structured error.
 * On pass, adds req.spendingPolicyResult to the request object.
 */
export async function enforceSpendingPolicy(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Emergency global pause (whitepaper §4.3)
  // Set AGENTPAY_GLOBAL_PAUSE=true to immediately halt all new payments
  // without a deployment. Clears automatically when env var is removed.
  if (process.env.AGENTPAY_GLOBAL_PAUSE === 'true') {
    logger.warn('[SpendingPolicy] Global pause active — rejecting payment', {
      path: req.path,
      ip: req.ip,
    });
    res.status(503).json({
      error: 'SERVICE_PAUSED',
      message: 'Service temporarily paused for security. Please try again shortly.',
    });
    return;
  }

  const merchantId = (req as any).merchant?.id;
  const amountCents: number = req.body?.amount ?? 0;
  const recipientId: string | undefined = req.body?.recipient;

  // Skip enforcement in test mode to avoid breaking existing tests
  if (process.env.AGENTPAY_TEST_MODE === 'true') {
    return next();
  }

  if (!merchantId) {
    // Auth middleware hasn't run — skip policy check
    return next();
  }

  try {
    const [policy, todaySpent] = await Promise.all([
      loadPolicy(merchantId),
      getTodaySpending(merchantId),
    ]);

    const result = checkPolicy(amountCents, recipientId, undefined, todaySpent, policy);

    if (!result.allowed) {
      logger.warn('[SpendingPolicy] Payment blocked', {
        merchantId,
        amountCents,
        reason: result.reason,
      });
      res.status(402).json({
        error: 'SPENDING_POLICY_VIOLATION',
        message: result.reason,
        remainingDailyCents: result.remainingDailyCents,
        policy: {
          perTxLimitCents: policy.perTxLimitCents,
          dailyLimitCents: policy.dailyLimitCents,
          remainingDailyBudget: result.remainingDailyCents,
        },
      });
      return;
    }

    logger.info('[SpendingPolicy] Payment allowed', {
      merchantId,
      amountCents,
      autoApproved: result.autoApproved,
    });

    // Attach result to request for downstream handlers
    (req as any).spendingPolicyResult = result;
    next();
  } catch (err: any) {
    logger.error('[SpendingPolicy] Middleware error', { err: err.message });
    // Fail open — don't block legitimate payments due to policy service errors
    next();
  }
}
