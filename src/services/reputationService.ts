import { query } from '../db/index';
import { logger } from '../logger';

export interface AgentReputation {
  agentId: string;
  trustScore: number;
  totalPayments: number;
  successRate: number;
  disputeRate: number;
  lastPaymentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Time-based decay factor.
 * Uses exponential decay: factor = e^(-λ * daysSinceLastPayment)
 * λ = 0.005 so a score decays to ~83% after 40 days, ~61% after 100 days.
 */
const DECAY_LAMBDA = 0.005;

export function computeDecayFactor(lastPaymentAt: Date | null): number {
  if (!lastPaymentAt) return 1;
  const daysSince = (Date.now() - lastPaymentAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-DECAY_LAMBDA * daysSince);
}

/**
 * Computes trust score using a weighted formula:
 *   rawScore = 100 * successRate * (1 - disputeRate)
 *   trustScore = round(rawScore * decayFactor)
 * Clamped to [0, 100].
 */
export function computeTrustScore(
  successRate: number,
  disputeRate: number,
  lastPaymentAt: Date | null
): number {
  const rawScore = 100 * successRate * (1 - disputeRate);
  const decayed = rawScore * computeDecayFactor(lastPaymentAt);
  return Math.round(Math.max(0, Math.min(100, decayed)));
}

/**
 * Returns the reputation record for an agent, or null if not found.
 * If the agent_reputation table has no record, falls back to computing
 * a live score from payment_intents where metadata->>'agentId' matches.
 */
export async function getReputation(agentId: string): Promise<AgentReputation | null> {
  try {
    const result = await query(
      `SELECT agent_id as "agentId", trust_score as "trustScore",
              total_payments as "totalPayments", success_rate as "successRate",
              dispute_rate as "disputeRate", last_payment_at as "lastPaymentAt",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM agent_reputation WHERE agent_id = $1`,
      [agentId]
    );
    if (result.rows.length > 0) {
      return result.rows[0] as AgentReputation;
    }

    // Fallback: compute from payment_intents where metadata->>'agentId' matches
    const intentsResult = await query(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) as verified_count,
         MAX(updated_at) as last_payment_at
       FROM payment_intents
       WHERE metadata->>'agentId' = $1`,
      [agentId]
    );

    const row = intentsResult.rows[0];
    const total = parseInt(row?.total ?? '0', 10);
    if (total === 0) return null;

    const verifiedCount = parseInt(row?.verified_count ?? '0', 10);
    const successRate = total > 0 ? verifiedCount / total : 0;
    const lastPaymentAt = row?.last_payment_at ? new Date(row.last_payment_at) : null;
    const trustScore = computeTrustScore(successRate, 0, lastPaymentAt);
    const now = new Date();

    return {
      agentId,
      trustScore,
      totalPayments: total,
      successRate,
      disputeRate: 0,
      lastPaymentAt,
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    logger.error('Error fetching agent reputation', { error, agentId });
    throw error;
  }
}

/**
 * Called when a payment by agentId is successfully verified.
 * Increments totalPayments, recomputes successRate, adjusts trustScore with
 * the weighted formula, and applies time-based score decay.
 *
 * Uses INSERT ... ON CONFLICT (upsert) so the first verified payment auto-creates
 * the reputation record.
 */
export async function updateReputationOnVerification(
  agentId: string,
  succeeded: boolean
): Promise<AgentReputation> {
  try {
    // Fetch existing record (may be null for new agents)
    const existing = await getReputation(agentId);

    const now = new Date();
    const prevTotal = existing?.totalPayments ?? 0;
    const prevSuccess = existing ? Math.round(existing.successRate * prevTotal) : 0;
    const prevDispute = existing ? Math.round(existing.disputeRate * prevTotal) : 0;

    const newTotal = prevTotal + 1;
    const newSuccessCount = succeeded ? prevSuccess + 1 : prevSuccess;
    const newSuccessRate = newTotal > 0 ? newSuccessCount / newTotal : 0;
    const newDisputeRate = newTotal > 0 ? prevDispute / newTotal : 0;

    const newTrustScore = computeTrustScore(newSuccessRate, newDisputeRate, now);

    const result = await query(
      `INSERT INTO agent_reputation
         (agent_id, trust_score, total_payments, success_rate, dispute_rate, last_payment_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (agent_id) DO UPDATE SET
         trust_score = $2,
         total_payments = $3,
         success_rate = $4,
         dispute_rate = $5,
         last_payment_at = $6,
         updated_at = NOW()
       RETURNING agent_id as "agentId", trust_score as "trustScore",
                 total_payments as "totalPayments", success_rate as "successRate",
                 dispute_rate as "disputeRate", last_payment_at as "lastPaymentAt",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [agentId, newTrustScore, newTotal, newSuccessRate, newDisputeRate, now]
    );

    logger.info('Agent reputation updated', {
      agentId,
      trustScore: newTrustScore,
      totalPayments: newTotal,
      successRate: newSuccessRate,
    });

    return result.rows[0] as AgentReputation;
  } catch (error) {
    logger.error('Error updating agent reputation', { error, agentId });
    throw error;
  }
}

/**
 * Stub helper for fast-track verification decisions.
 * An agent qualifies for fast-track when their trust score is high and
 * success rate is excellent.
 *
 * TODO (future): integrate into payment verification flow to skip confirmations
 * for trusted agents and reduce latency.
 */
export function shouldFastTrack(reputation: AgentReputation | null): boolean {
  if (!reputation) return false;
  return reputation.trustScore >= 80 && reputation.successRate >= 0.95 && reputation.totalPayments >= 10;
}

/**
 * Emits a reputation event for an agent after a payment outcome.
 * Thin wrapper around updateReputationOnVerification for use by other services.
 */
export async function emitReputationEvent(
  agentId: string,
  succeeded: boolean
): Promise<void> {
  await updateReputationOnVerification(agentId, succeeded);
}

export default {
  getReputation,
  updateReputationOnVerification,
  emitReputationEvent,
  computeTrustScore,
  computeDecayFactor,
  shouldFastTrack,
};
