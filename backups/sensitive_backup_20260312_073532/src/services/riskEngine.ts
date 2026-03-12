/**
 * Risk Engine — Centralized risk aggregation for all agent actions.
 *
 * Aggregates signals from:
 *   - Sybil resistance checks (wallet age, stake, counterparty diversity)
 *   - Behavioral oracle (predatory disputes, looping txs, wash trading)
 *   - Context-level heuristics (self-hire detection)
 *
 * @module services/riskEngine
 */

import { runSybilCheck, type WalletProfile } from '../reputation/sybil-resistance.js';
import {
  detectPredatoryDisputes,
  detectLoopingTransactions,
  detectWashTrading,
  detectRapidEscalation,
  type AgentBehaviorProfile,
  type BehaviorAlert,
} from '../monitoring/behavioral-oracle.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskContext {
  agentId: string;
  counterpartyId?: string;
  amountUsd?: number;
  transactionType: 'hire' | 'escrow_release' | 'job_create' | 'dispute';
  walletProfile?: {
    createdAt: Date;
    stakedUsdc: number;
    counterparties: string[];
    transactionsToday: number;
    transactionHistory: Array<{ from: string; to: string; amount: number; timestamp: Date }>;
  };
  behaviorProfile?: {
    agentId: string;
    disputeCount: number;
    totalEscrows: number;
    recentTransactions: Array<{ from: string; to: string; amount: number; timestamp: Date }>;
  };
}

export interface RiskAssessment {
  agentId: string;
  riskScore: number;
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  flags: string[];
  actions: Array<'warn' | 'block_job' | 'freeze_agent' | 'escalate_dispute'>;
  reasons: string[];
  assessedAt: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tierFromScore(score: number): RiskAssessment['riskTier'] {
  if (score <= 25) return 'LOW';
  if (score <= 50) return 'MEDIUM';
  if (score <= 75) return 'HIGH';
  return 'CRITICAL';
}

function actionsForTier(
  tier: RiskAssessment['riskTier'],
): RiskAssessment['actions'] {
  switch (tier) {
    case 'LOW':      return [];
    case 'MEDIUM':   return ['warn'];
    case 'HIGH':     return ['warn', 'block_job'];
    case 'CRITICAL': return ['warn', 'block_job', 'freeze_agent', 'escalate_dispute'];
  }
}

// ---------------------------------------------------------------------------
// Main assessment
// ---------------------------------------------------------------------------

export async function assessRisk(context: RiskContext): Promise<RiskAssessment> {
  const flags: string[] = [];
  const reasons: string[] = [];
  let riskScore = 0;

  // --- 1. Self-hire detection ---
  if (context.agentId && context.counterpartyId && context.agentId === context.counterpartyId) {
    flags.push('SELF_HIRE');
    reasons.push('Agent and counterparty are the same entity');
    riskScore = 100;

    const assessment: RiskAssessment = {
      agentId: context.agentId,
      riskScore: 100,
      riskTier: 'CRITICAL',
      flags,
      actions: ['block_job'],
      reasons,
      assessedAt: new Date(),
    };

    logger.warn({ agentId: context.agentId, flags }, 'Risk assessment: SELF_HIRE detected');
    return assessment;
  }

  // --- 2. Sybil resistance check ---
  const walletProfile: WalletProfile = {
    walletAddress: context.agentId,
    createdAt: context.walletProfile?.createdAt ?? new Date(),
    stakedUsdc: context.walletProfile?.stakedUsdc ?? 0,
    counterparties: context.walletProfile?.counterparties ?? [],
    transactionsToday: context.walletProfile?.transactionsToday ?? 0,
    transactionHistory: context.walletProfile?.transactionHistory ?? [],
  };

  const sybilResult = runSybilCheck(walletProfile);
  if (sybilResult.flags.length > 0) {
    flags.push(...sybilResult.flags);
    reasons.push(`Sybil check failed: ${sybilResult.flags.join(', ')}`);
  }
  riskScore += sybilResult.flags.length * 15;

  // --- 3. Behavioral oracle checks ---
  if (context.behaviorProfile) {
    const behaviorProfile: AgentBehaviorProfile = {
      agentId: context.behaviorProfile.agentId,
      disputeCount: context.behaviorProfile.disputeCount,
      totalEscrows: context.behaviorProfile.totalEscrows,
      recentTransactions: context.behaviorProfile.recentTransactions,
    };

    const behaviorAlerts: (BehaviorAlert | null)[] = [
      detectPredatoryDisputes(behaviorProfile),
      detectLoopingTransactions(behaviorProfile),
      detectWashTrading(behaviorProfile),
    ];

    for (const alert of behaviorAlerts) {
      if (alert) {
        flags.push(alert.alertType);
        reasons.push(alert.description);
        riskScore += 20;
      }
    }
  }

  // Cap score at 100
  riskScore = Math.min(100, riskScore);

  const riskTier = tierFromScore(riskScore);
  const actions = actionsForTier(riskTier);

  const assessment: RiskAssessment = {
    agentId: context.agentId,
    riskScore,
    riskTier,
    flags,
    actions,
    reasons,
    assessedAt: new Date(),
  };

  logger.info({ agentId: context.agentId, riskScore, riskTier, flags }, 'Risk assessment completed');
  return assessment;
}

/**
 * Quick check — returns true if the action should be blocked.
 */
export async function shouldBlock(context: RiskContext): Promise<boolean> {
  const assessment = await assessRisk(context);
  return assessment.actions.includes('block_job') || assessment.actions.includes('freeze_agent');
}
