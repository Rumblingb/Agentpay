/**
 * ReputationOracleAgent - Constitutional Layer Agent #2
 *
 * Queries and packages trust context from AgentPay's reputation graph.
 * Provides counterparty risk assessment for serious transactions.
 *
 * Core Functions:
 * 1. Query trust scores from the graph
 * 2. Risk assessment for transactions
 * 3. Comparative analysis between agents
 * 4. Historical behavior patterns
 *
 * Revenue: $1-5 per query
 * Moat: Exclusive access to transaction graph data
 */

import { prisma } from '../lib/prisma.js';

interface ReputationQuery {
  agentId: string;
  requestingAgentId: string;
  depth?: 'basic' | 'standard' | 'comprehensive';
}

interface ReputationScore {
  agentId: string;
  trustScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'unknown';
  totalTransactions: number;
  successRate: number;
  disputeRate: number;
  avgTransactionSize: number;
  uniqueCounterparties: number;
  accountAge: number;
  verificationStatus: 'verified' | 'attested' | 'unverified';
  recentActivity: {
    last7Days: number;
    last30Days: number;
  };
  flags: string[];
  recommendation: 'proceed' | 'caution' | 'decline';
}

interface ComparativeAnalysis {
  agent1: ReputationScore;
  agent2: ReputationScore;
  recommendation: string;
  keyDifferences: string[];
  riskDelta: string;
}

class ReputationOracleAgent {
  private agentId = 'reputation_oracle_001';

  private QUERY_PRICE = {
    basic: 1,
    standard: 3,
    comprehensive: 5
  };

  private RISK_THRESHOLDS = {
    minTransactions: 5,
    minTrustScore: 60,
    maxDisputeRate: 0.15,
    minAccountAgeDays: 7
  };

  /**
   * Get reputation score for an agent
   */
  async getReputation(query: ReputationQuery): Promise<ReputationScore> {
    const depth = query.depth || 'standard';

    await this.chargeQuery(query.requestingAgentId, this.QUERY_PRICE[depth]);

    const agent = await prisma.agent.findUnique({
      where: { id: query.agentId },
      include: {
        verificationCredentials: {
          where: {
            expiresAt: { gt: new Date() },
            revoked: false
          }
        }
      }
    });

    if (!agent) {
      throw new Error('Agent not found');
    }

    // Fetch transactions separately (agent can be buyer or seller)
    const take = depth === 'comprehensive' ? 1000 : depth === 'standard' ? 100 : 50;
    const [buyerTxs, sellerTxs] = await Promise.all([
      prisma.agentTransaction.findMany({
        where: { buyerAgentId: query.agentId },
        orderBy: { createdAt: 'desc' },
        take
      }),
      prisma.agentTransaction.findMany({
        where: { sellerAgentId: query.agentId },
        orderBy: { createdAt: 'desc' },
        take
      })
    ]);

    // Deduplicate and normalise to a common shape
    const seen = new Set<string>();
    const transactions = [...buyerTxs, ...sellerTxs]
      .filter(tx => {
        if (seen.has(tx.id)) return false;
        seen.add(tx.id);
        return true;
      })
      .map(tx => ({
        id: tx.id,
        status: tx.status,
        amount: tx.amount,
        createdAt: tx.createdAt,
        fromAgent: tx.buyerAgentId,
        toAgent: tx.sellerAgentId
      }));

    const metrics = this.calculateMetrics(agent, transactions);
    const risk = this.assessRisk(metrics);

    const score: ReputationScore = {
      agentId: query.agentId,
      trustScore: metrics.trustScore,
      riskLevel: risk.level,
      totalTransactions: metrics.totalTransactions,
      successRate: metrics.successRate,
      disputeRate: metrics.disputeRate,
      avgTransactionSize: metrics.avgTransactionSize,
      uniqueCounterparties: metrics.uniqueCounterparties,
      accountAge: metrics.accountAgeDays,
      verificationStatus: this.getVerificationStatus(agent.verificationCredentials),
      recentActivity: metrics.recentActivity,
      flags: risk.flags,
      recommendation: risk.recommendation
    };

    await this.logQuery(query, score);

    return score;
  }

  /**
   * Compare two agents
   */
  async compareAgents(
    agentId1: string,
    agentId2: string,
    requestingAgentId: string
  ): Promise<ComparativeAnalysis> {
    await this.chargeQuery(requestingAgentId, this.QUERY_PRICE.standard * 2);

    const [agent1, agent2] = await Promise.all([
      this.getReputation({ agentId: agentId1, requestingAgentId, depth: 'standard' }),
      this.getReputation({ agentId: agentId2, requestingAgentId, depth: 'standard' })
    ]);

    const comparison = this.generateComparison(agent1, agent2);

    return {
      agent1,
      agent2,
      recommendation: comparison.recommendation,
      keyDifferences: comparison.differences,
      riskDelta: comparison.riskDelta
    };
  }

  /**
   * Get trust score only (lightweight query)
   */
  async getTrustScore(agentId: string, requestingAgentId: string): Promise<number> {
    await this.chargeQuery(requestingAgentId, 0.5);

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { trustScore: true }
    });

    return agent?.trustScore ?? 0;
  }

  /**
   * Batch reputation lookup
   */
  async batchLookup(
    agentIds: string[],
    requestingAgentId: string
  ): Promise<Map<string, ReputationScore>> {
    if (agentIds.length > 10) {
      throw new Error('Maximum 10 agents per batch query');
    }

    await this.chargeQuery(requestingAgentId, agentIds.length * 0.75);

    const results = new Map<string, ReputationScore>();

    for (const agentId of agentIds) {
      const score = await this.getReputation({
        agentId,
        requestingAgentId,
        depth: 'basic'
      });
      results.set(agentId, score);
    }

    return results;
  }

  // Private calculation methods

  private calculateMetrics(agent: any, transactions: any[]) {
    const now = new Date();

    const completedTxs = transactions.filter(tx => tx.status === 'completed');
    const disputedTxs = transactions.filter(tx => tx.status === 'disputed');
    const totalTransactions = transactions.length;

    const successRate = totalTransactions > 0
      ? completedTxs.length / totalTransactions
      : 0;

    const disputeRate = totalTransactions > 0
      ? disputedTxs.length / totalTransactions
      : 0;

    const avgTransactionSize = completedTxs.length > 0
      ? completedTxs.reduce((sum: number, tx: any) => sum + tx.amount, 0) / completedTxs.length
      : 0;

    const counterparties = new Set(
      transactions.map(tx =>
        tx.fromAgent === agent.id ? tx.toAgent : tx.fromAgent
      )
    );

    const accountAgeDays = Math.floor(
      (now.getTime() - new Date(agent.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    const last7Days = transactions.filter(tx => {
      const age = now.getTime() - new Date(tx.createdAt).getTime();
      return age < 7 * 24 * 60 * 60 * 1000;
    }).length;

    const last30Days = transactions.filter(tx => {
      const age = now.getTime() - new Date(tx.createdAt).getTime();
      return age < 30 * 24 * 60 * 60 * 1000;
    }).length;

    // Trust score (0-100), seeded from stored value or calculated fresh
    let trustScore = agent.trustScore ?? 50;

    if (successRate >= 0.95) trustScore += 20;
    else if (successRate >= 0.85) trustScore += 10;

    if (totalTransactions >= 50) trustScore += 15;
    else if (totalTransactions >= 20) trustScore += 10;
    else if (totalTransactions >= 10) trustScore += 5;

    if (counterparties.size >= 10) trustScore += 10;
    else if (counterparties.size >= 5) trustScore += 5;

    if (accountAgeDays >= 90) trustScore += 10;
    else if (accountAgeDays >= 30) trustScore += 5;

    if (disputeRate > 0.15) trustScore -= 30;
    else if (disputeRate > 0.10) trustScore -= 20;
    else if (disputeRate > 0.05) trustScore -= 10;

    if (totalTransactions < 5) trustScore -= 15;
    if (accountAgeDays < 7) trustScore -= 10;

    if (agent.verificationCredentials?.length > 0) trustScore += 5;

    trustScore = Math.max(0, Math.min(100, trustScore));

    return {
      trustScore,
      totalTransactions,
      successRate,
      disputeRate,
      avgTransactionSize,
      uniqueCounterparties: counterparties.size,
      accountAgeDays,
      recentActivity: { last7Days, last30Days }
    };
  }

  private assessRisk(metrics: any): {
    level: 'low' | 'medium' | 'high' | 'unknown';
    flags: string[];
    recommendation: 'proceed' | 'caution' | 'decline';
  } {
    const flags: string[] = [];
    let riskPoints = 0;

    if (metrics.totalTransactions < this.RISK_THRESHOLDS.minTransactions) {
      flags.push('Limited transaction history');
      riskPoints += 2;
    }
    if (metrics.trustScore < this.RISK_THRESHOLDS.minTrustScore) {
      flags.push('Low trust score');
      riskPoints += 3;
    }
    if (metrics.disputeRate > this.RISK_THRESHOLDS.maxDisputeRate) {
      flags.push('High dispute rate');
      riskPoints += 3;
    }
    if (metrics.accountAgeDays < this.RISK_THRESHOLDS.minAccountAgeDays) {
      flags.push('New account');
      riskPoints += 1;
    }
    if (metrics.uniqueCounterparties < 3) {
      flags.push('Limited network');
      riskPoints += 1;
    }
    if (metrics.recentActivity.last30Days === 0) {
      flags.push('No recent activity');
      riskPoints += 2;
    }

    let level: 'low' | 'medium' | 'high' | 'unknown';
    let recommendation: 'proceed' | 'caution' | 'decline';

    if (riskPoints === 0) {
      level = 'low';
      recommendation = 'proceed';
    } else if (riskPoints <= 3) {
      level = 'medium';
      recommendation = 'caution';
    } else {
      level = 'high';
      recommendation = 'decline';
    }

    return { level, flags, recommendation };
  }

  private getVerificationStatus(credentials: any[]): 'verified' | 'attested' | 'unverified' {
    if (!credentials || credentials.length === 0) return 'unverified';

    const highestTrust = credentials.reduce((max: number, cred: any) => {
      const levels: Record<string, number> = { verified: 3, attested: 2, 'self-reported': 1 };
      const credLevel = levels[cred.trustLevel] || 0;
      return credLevel > max ? credLevel : max;
    }, 0);

    if (highestTrust >= 3) return 'verified';
    if (highestTrust >= 2) return 'attested';
    return 'unverified';
  }

  private generateComparison(agent1: ReputationScore, agent2: ReputationScore) {
    const differences: string[] = [];

    if (Math.abs(agent1.trustScore - agent2.trustScore) >= 20) {
      const higher = agent1.trustScore > agent2.trustScore ? 'Agent 1' : 'Agent 2';
      differences.push(`${higher} has significantly higher trust score`);
    }
    if (agent1.totalTransactions > agent2.totalTransactions * 2) {
      differences.push('Agent 1 has much more transaction history');
    } else if (agent2.totalTransactions > agent1.totalTransactions * 2) {
      differences.push('Agent 2 has much more transaction history');
    }
    if (agent1.disputeRate > agent2.disputeRate + 0.05) {
      differences.push('Agent 1 has higher dispute rate');
    } else if (agent2.disputeRate > agent1.disputeRate + 0.05) {
      differences.push('Agent 2 has higher dispute rate');
    }

    let recommendation: string;
    if (agent1.trustScore > agent2.trustScore + 15) {
      recommendation = 'Agent 1 recommended based on stronger reputation';
    } else if (agent2.trustScore > agent1.trustScore + 15) {
      recommendation = 'Agent 2 recommended based on stronger reputation';
    } else {
      recommendation = 'Both agents have similar reputation levels';
    }

    const riskOrder: Record<string, number> = { low: 1, medium: 2, high: 3, unknown: 4 };
    const risk1 = riskOrder[agent1.riskLevel];
    const risk2 = riskOrder[agent2.riskLevel];

    let riskDelta: string;
    if (risk1 < risk2) {
      riskDelta = 'Agent 1 is lower risk';
    } else if (risk2 < risk1) {
      riskDelta = 'Agent 2 is lower risk';
    } else {
      riskDelta = 'Similar risk levels';
    }

    return { recommendation, differences, riskDelta };
  }

  private async chargeQuery(requestingAgentId: string, amount: number): Promise<void> {
    await prisma.agentFeeTransaction.create({
      data: {
        fromAgent: requestingAgentId,
        toAgent: this.agentId,
        amount,
        status: 'completed',
        description: 'Reputation query fee',
        metadata: { service: 'ReputationOracle' }
      }
    });
  }

  private async logQuery(query: ReputationQuery, result: ReputationScore): Promise<void> {
    await prisma.reputationQueryLog.create({
      data: {
        requestingAgentId: query.requestingAgentId,
        queriedAgentId: query.agentId,
        depth: query.depth || 'standard',
        trustScore: result.trustScore,
        riskLevel: result.riskLevel
      }
    });
  }
}

export const reputationOracleAgent = new ReputationOracleAgent();

export async function handleReputationQuery(req: any, res: any) {
  const { action, ...params } = req.body;

  try {
    switch (action) {
      case 'get_reputation': {
        const score = await reputationOracleAgent.getReputation(params);
        return res.json(score);
      }
      case 'compare': {
        const comparison = await reputationOracleAgent.compareAgents(
          params.agentId1,
          params.agentId2,
          params.requestingAgentId
        );
        return res.json(comparison);
      }
      case 'get_trust_score': {
        const trustScore = await reputationOracleAgent.getTrustScore(
          params.agentId,
          params.requestingAgentId
        );
        return res.json({ trustScore });
      }
      case 'batch_lookup': {
        const results = await reputationOracleAgent.batchLookup(
          params.agentIds,
          params.requestingAgentId
        );
        return res.json({ results: Object.fromEntries(results) });
      }
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error: any) {
    console.error('Reputation oracle error:', error);
    return res.status(500).json({ error: error.message });
  }
}
