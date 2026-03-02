/**
 * Merchant Analytics Service
 *
 * Provides analytics data for the merchant dashboard including:
 * - Revenue trends (daily/weekly/monthly)
 * - Top-spending agents
 * - Churn risk assessment
 * - Moltbook vs API revenue breakdown
 */

import { query } from '../db/index';
import { logger } from '../logger';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RevenueTrend {
  date: string;
  revenue: number;
  transactionCount: number;
}

export interface TopAgent {
  agentId: string;
  totalSpent: number;
  transactionCount: number;
  lastActive: string;
}

export interface ChurnRisk {
  agentId: string;
  lastActive: string;
  daysSinceLastActivity: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface MoltbookStats {
  agenticRevenue: number;
  directApiRevenue: number;
  agenticTransactions: number;
  directApiTransactions: number;
}

export interface MerchantAnalytics {
  revenueTrends: RevenueTrend[];
  topAgents: TopAgent[];
  churnRisks: ChurnRisk[];
  moltbookStats: MoltbookStats;
  summary: {
    totalRevenue: number;
    totalTransactions: number;
    activeAgents: number;
    periodDays: number;
  };
}

// ── Analytics Queries ──────────────────────────────────────────────────────

/**
 * Returns comprehensive analytics for a merchant's dashboard.
 * @param merchantId - The merchant UUID
 * @param periodDays - Number of days to look back (default 30)
 */
export async function getMerchantAnalytics(
  merchantId: string,
  periodDays = 30,
): Promise<MerchantAnalytics> {
  // Revenue trends (daily)
  let revenueTrends: RevenueTrend[] = [];
  try {
    const trendsResult = await query(
      `SELECT DATE(created_at) as date,
              COALESCE(SUM(amount), 0) as revenue,
              COUNT(*) as transaction_count
       FROM payment_intents
       WHERE merchant_id = $1
         AND status = 'verified'
         AND created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [merchantId, periodDays],
    );
    revenueTrends = trendsResult.rows.map((r) => ({
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
      revenue: parseFloat(r.revenue),
      transactionCount: parseInt(r.transaction_count, 10),
    }));
  } catch (err) {
    logger.warn('Revenue trends query failed', { err });
  }

  // Top spending agents
  let topAgents: TopAgent[] = [];
  try {
    const agentsResult = await query(
      `SELECT metadata->>'agentId' as agent_id,
              COALESCE(SUM(amount), 0) as total_spent,
              COUNT(*) as transaction_count,
              MAX(created_at) as last_active
       FROM payment_intents
       WHERE merchant_id = $1
         AND metadata->>'agentId' IS NOT NULL
         AND created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY metadata->>'agentId'
       ORDER BY total_spent DESC
       LIMIT 20`,
      [merchantId, periodDays],
    );
    topAgents = agentsResult.rows.map((r) => ({
      agentId: r.agent_id,
      totalSpent: parseFloat(r.total_spent),
      transactionCount: parseInt(r.transaction_count, 10),
      lastActive: new Date(r.last_active).toISOString(),
    }));
  } catch (err) {
    logger.warn('Top agents query failed', { err });
  }

  // Churn risk: agents inactive for 7+ days
  let churnRisks: ChurnRisk[] = [];
  try {
    const churnResult = await query(
      `SELECT metadata->>'agentId' as agent_id,
              MAX(created_at) as last_active,
              EXTRACT(DAY FROM NOW() - MAX(created_at)) as days_inactive
       FROM payment_intents
       WHERE merchant_id = $1
         AND metadata->>'agentId' IS NOT NULL
         AND created_at >= NOW() - INTERVAL '90 days'
       GROUP BY metadata->>'agentId'
       HAVING MAX(created_at) < NOW() - INTERVAL '7 days'
       ORDER BY days_inactive DESC
       LIMIT 20`,
      [merchantId],
    );
    churnRisks = churnResult.rows.map((r) => {
      const daysInactive = parseInt(r.days_inactive, 10);
      let riskLevel: 'low' | 'medium' | 'high' = 'low';
      if (daysInactive > 30) riskLevel = 'high';
      else if (daysInactive > 14) riskLevel = 'medium';

      return {
        agentId: r.agent_id,
        lastActive: new Date(r.last_active).toISOString(),
        daysSinceLastActivity: daysInactive,
        riskLevel,
      };
    });
  } catch (err) {
    logger.warn('Churn risk query failed', { err });
  }

  // Moltbook vs direct API revenue
  let moltbookStats: MoltbookStats = {
    agenticRevenue: 0,
    directApiRevenue: 0,
    agenticTransactions: 0,
    directApiTransactions: 0,
  };
  try {
    const moltbookResult = await query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE metadata->>'agentId' IS NOT NULL), 0) as agentic_revenue,
         COALESCE(SUM(amount) FILTER (WHERE metadata->>'agentId' IS NULL), 0) as direct_revenue,
         COUNT(*) FILTER (WHERE metadata->>'agentId' IS NOT NULL) as agentic_count,
         COUNT(*) FILTER (WHERE metadata->>'agentId' IS NULL) as direct_count
       FROM payment_intents
       WHERE merchant_id = $1
         AND status = 'verified'
         AND created_at >= NOW() - INTERVAL '1 day' * $2`,
      [merchantId, periodDays],
    );
    const row = moltbookResult.rows[0];
    if (row) {
      moltbookStats = {
        agenticRevenue: parseFloat(row.agentic_revenue),
        directApiRevenue: parseFloat(row.direct_revenue),
        agenticTransactions: parseInt(row.agentic_count, 10),
        directApiTransactions: parseInt(row.direct_count, 10),
      };
    }
  } catch (err) {
    logger.warn('Moltbook stats query failed', { err });
  }

  // Summary
  const totalRevenue = revenueTrends.reduce((sum, t) => sum + t.revenue, 0);
  const totalTransactions = revenueTrends.reduce((sum, t) => sum + t.transactionCount, 0);

  return {
    revenueTrends,
    topAgents,
    churnRisks,
    moltbookStats,
    summary: {
      totalRevenue,
      totalTransactions,
      activeAgents: topAgents.length,
      periodDays,
    },
  };
}

export default { getMerchantAnalytics };
