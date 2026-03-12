import { query } from '../db/index.js';
import { adjustScore } from './agentrankService.js';
import { logger } from '../logger.js';

export interface Reputation {
  agentId: string;
  trustScore: number;
  totalPayments: number;
  successRate: number;
  disputeRate: number;
  lastPaymentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getReputation(agentId: string): Promise<Reputation | null> {
  try {
    const res = await query('SELECT * FROM agent_reputation WHERE agent_id = $1', [agentId]);
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return {
      agentId: row.agent_id,
      trustScore: parseFloat(row.trust_score || '0'),
      totalPayments: parseInt(row.total_payments || '0', 10),
      successRate: parseFloat(row.success_rate || '0'),
      disputeRate: parseFloat(row.dispute_rate || '0'),
      lastPaymentAt: row.last_payment_at ? new Date(row.last_payment_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  } catch (err: any) {
    const isTableMissing = typeof err?.message === 'string' && err.message.includes('does not exist');
    if (isTableMissing) return null;
    throw err;
  }
}

export async function updateReputationOnVerification(agentId: string, success: boolean): Promise<Reputation> {
  // Try to get existing
  const existing = await getReputation(agentId);
  
  if (!existing) {
    const successRate = success ? 1 : 0;
    const trustScore = success ? 100 : 0;
    
    const res = await query(
      `INSERT INTO agent_reputation 
       (agent_id, total_payments, success_rate, trust_score, dispute_rate, last_payment_at)
       VALUES ($1, 1, $2, $3, 0, NOW())
       RETURNING *`,
      [agentId, successRate, trustScore]
    );

    await bridgeToAgentRank(agentId, success);
    return (await getReputation(agentId))!; // Use getReputation to ensure type casting
  }

  const newTotal = existing.totalPayments + 1;
  const newSuccessCount = (existing.successRate * existing.totalPayments) + (success ? 1 : 0);
  const newSuccessRate = newSuccessCount / newTotal;
  const newTrustScore = Math.round(newSuccessRate * 100); // Simplified logic for example

  await query(
    `UPDATE agent_reputation 
     SET total_payments = $1, success_rate = $2, trust_score = $3, last_payment_at = NOW(), updated_at = NOW()
     WHERE agent_id = $4`,
    [newTotal, newSuccessRate, newTrustScore, agentId]
  );

  await bridgeToAgentRank(agentId, success);
  return (await getReputation(agentId))!;
}

/** Awaited bridge: sync legacy reputation events to AgentRank scores. */
async function bridgeToAgentRank(agentId: string, success: boolean): Promise<void> {
  const delta = success ? 5 : -5;
  const detail = success ? 'Payment verified' : 'Payment failed';
  try {
    await adjustScore(agentId, delta, 'payment_verification', detail);
  } catch (err: any) {
    logger.error('AgentRank bridge failed', { agentId, error: err?.message });
  }
}

// Pure functions used in tests
export function computeDecayFactor(lastPaymentAt: Date | null): number {
  if (!lastPaymentAt) return 1;
  const daysSince = (Date.now() - new Date(lastPaymentAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-0.005 * daysSince);
}

export function computeTrustScore(successRate: number, disputeRate: number, lastPaymentAt: Date | null): number {
  const decay = computeDecayFactor(lastPaymentAt);
  const score = (successRate * 100) - (disputeRate * 200);
  return Math.max(0, Math.min(100, score * decay));
}

export function shouldFastTrack(rep: Reputation | null): boolean {
  if (!rep) return false;
  return rep.trustScore >= 90 && rep.totalPayments >= 10;
}
// At the bottom of reputationService.ts, add this alias export
export { updateReputationOnVerification as emitReputationEvent };