/**
 * Ranking Service — computes marketplace discovery rankings.
 *
 * Ranking formula (higher = better discovery position):
 *   rank = agentrankScore * 0.4
 *         + incentiveComposite * 0.3
 *         + reputationSuccessRate * 0.2
 *         + boostMultiplier * 0.1
 *
 * The ranking is recomputed on-demand (per request) and optionally cached.
 * In production, materialise this into a `marketplace_rank` column on agents
 * and refresh periodically via a cron job.
 */

import { query } from '../db/index.js';
import { logger } from '../logger.js';
import { computeIncentiveScores, getActiveBoostMultiplier } from './incentives.js';

export interface RankedAgent {
  agentId: string;
  displayName: string;
  service: string | null;
  rating: number;
  tasksCompleted: number;
  totalEarnings: number;
  rankScore: number;
}

// ---------------------------------------------------------------------------
// Rank a list of agents
// ---------------------------------------------------------------------------
export async function rankAgents(
  agentIds: string[],
): Promise<RankedAgent[]> {
  if (agentIds.length === 0) return [];

  // Bulk fetch agent base data
  const agentResult = await query(
    `SELECT id, display_name, service, rating, tasks_completed, total_earnings
       FROM agents
      WHERE id = ANY($1::text[])`,
    [agentIds],
  );

  // Bulk fetch agentrank scores
  const rankResult = await query(
    `SELECT agent_id, score FROM agentrank_scores WHERE agent_id = ANY($1::text[])`,
    [agentIds],
  );
  const rankMap = new Map(rankResult.rows.map((r: any) => [r.agent_id, r.score]));

  // Bulk fetch reputation
  const repResult = await query(
  let repMap = new Map();
  try {
    const repResult = await query(
      `SELECT agent_id, success_rate FROM agent_reputation_network WHERE agent_id = ANY($1::text[])`,
      [agentIds],
    );
    repMap = new Map(repResult.rows.map((r: any) => [r.agent_id, r.success_rate]));
  } catch (err: any) {
    const isTableMissing = typeof err?.message === 'string' && err.message.includes('does not exist');
    if (!isTableMissing) throw err;
    // Non-fatal if table missing
  }

  // Compute ranked scores
  const ranked: RankedAgent[] = await Promise.all(
    agentResult.rows.map(async (agent) => {
      const agentRank = rankMap.get(agent.id) ?? 0;
      const successRate = repMap.get(agent.id) ?? 0.5;

      let incentive = { compositeScore: 50 };
      try {
        incentive = await computeIncentiveScores(agent.id);
      } catch {
        // Non-fatal
      }

      let boost = 1.0;
      try {
        boost = await getActiveBoostMultiplier(agent.id);
      } catch {
        // Non-fatal
      }

      const rankScore =
        (agentRank / 1000) * 40 +
        incentive.compositeScore * 0.3 +
        successRate * 20 +
        (boost - 1) * 10;

      return {
        agentId: agent.id,
        displayName: agent.display_name,
        service: agent.service,
        rating: agent.rating,
        tasksCompleted: agent.tasks_completed,
        totalEarnings: agent.total_earnings,
        rankScore: Math.round(rankScore * 100) / 100,
      };
    }),
  );

  // Sort descending by rankScore
  ranked.sort((a, b) => b.rankScore - a.rankScore);
  return ranked;
}

// ---------------------------------------------------------------------------
// Top-N agents by rank (for leaderboard / discovery)
// ---------------------------------------------------------------------------
export async function getTopRankedAgents(limit = 20): Promise<RankedAgent[]> {
  try {
    const result = await query(
      `SELECT id FROM agents WHERE service IS NOT NULL ORDER BY rating DESC, tasks_completed DESC LIMIT $1`,
      [limit * 2], // fetch extra so ranking can reorder
    );
    const agentIds = result.rows.map((r) => r.id);
    const ranked = await rankAgents(agentIds);
    return ranked.slice(0, limit);
  } catch (err: any) {
    logger.error({ err: err.message }, '[Ranking] getTopRankedAgents failed');
    return [];
  }
}
