/**
 * Incentive Layer — soft reward system that does NOT require a crypto token.
 *
 * Scoring dimensions:
 *   contribution_score  — task throughput, new agent introductions
 *   fulfillment_score   — on-time delivery, completion rate
 *   quality_score       — peer ratings, dispute outcomes
 *
 * Reward events (logged to reward_events table):
 *   BONUS          — one-off credit for milestone
 *   BOOST          — temporary ranking multiplier
 *   PENALTY        — score deduction for bad behaviour
 *
 * These scores feed into marketplace ranking and risk engine.
 */

import { query } from '../db/index.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface IncentiveScores {
  contributionScore: number;
  fulfillmentScore: number;
  qualityScore: number;
  compositeScore: number;
}

export type RewardEventType = 'BONUS' | 'BOOST' | 'PENALTY';

export interface RewardEvent {
  agentId: string;
  eventType: RewardEventType;
  amount: number; // score delta
  reason: string;
  expiresAt?: Date; // for BOOSTs
}

// ---------------------------------------------------------------------------
// Compute composite incentive score for an agent
// ---------------------------------------------------------------------------
export async function computeIncentiveScores(agentId: string): Promise<IncentiveScores> {
  // Contribution: tasks completed (from agents table)
  const agentResult = await query(
    `SELECT tasks_completed, total_earnings, rating FROM agents WHERE id = $1`,
    [agentId],
  );

  const agent = agentResult.rows[0];
  if (!agent) {
    return { contributionScore: 0, fulfillmentScore: 0, qualityScore: 0, compositeScore: 0 };
  }

  // Contribution — tasks * log earnings bonus
  const contributionScore = Math.min(
    100,
    (agent.tasks_completed ?? 0) * 2 + Math.log1p(agent.total_earnings ?? 0) * 5,
  );

  // Fulfillment — derived from AgentRank success_rate if available
  let fulfillmentScore = 50; // default neutral
  try {
    const repResult = await query(
      `SELECT success_rate, dispute_rate FROM agent_reputation_network WHERE agent_id = $1`,
      [agentId],
    );
    if (repResult.rows.length > 0) {
      const r = repResult.rows[0];
      fulfillmentScore = Math.round(
        (r.success_rate ?? 0.5) * 80 - (r.dispute_rate ?? 0) * 30,
      );
      fulfillmentScore = Math.max(0, Math.min(100, fulfillmentScore));
    }
  } catch {
    // Non-fatal
  }

  // Quality — from rating (1–5 → 0–100) + reward event net delta
  let rewardDelta = 0;
  try {
    const rewardResult = await query(
      `SELECT COALESCE(SUM(amount), 0) AS net
         FROM reward_events
        WHERE agent_id = $1
          AND (expires_at IS NULL OR expires_at > NOW())`,
      [agentId],
    );
    rewardDelta = Number(rewardResult.rows[0]?.net ?? 0);
  } catch {
    // Non-fatal
  }

  const qualityScore = Math.min(
    100,
    Math.max(0, ((agent.rating ?? 3) - 1) * 25 + rewardDelta),
  );

  const compositeScore = Math.round(
    contributionScore * 0.3 + fulfillmentScore * 0.4 + qualityScore * 0.3,
  );

  return { contributionScore, fulfillmentScore, qualityScore, compositeScore };
}

// ---------------------------------------------------------------------------
// Record a reward event
// ---------------------------------------------------------------------------
export async function recordRewardEvent(event: RewardEvent): Promise<void> {
  try {
    await query(
      `INSERT INTO reward_events (agent_id, event_type, amount, reason, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        event.agentId,
        event.eventType,
        event.amount,
        event.reason,
        event.expiresAt ?? null,
      ],
    );
    logger.info(
      { agentId: event.agentId, type: event.eventType, amount: event.amount },
      '[Incentives] Reward event recorded',
    );
  } catch (err: any) {
    logger.warn({ err: err.message }, '[Incentives] Failed to record reward event');
  }
}

// ---------------------------------------------------------------------------
// Apply a boost multiplier for leaderboard ranking
// ---------------------------------------------------------------------------
export async function getActiveBoostMultiplier(agentId: string): Promise<number> {
  try {
    const result = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM reward_events
        WHERE agent_id = $1
          AND event_type = 'BOOST'
          AND (expires_at IS NULL OR expires_at > NOW())`,
      [agentId],
    );
    const boost = Number(result.rows[0]?.total ?? 0);
    // Cap multiplier between 1.0x and 2.0x
    return Math.min(2.0, 1.0 + boost / 100);
  } catch {
    return 1.0;
  }
}
