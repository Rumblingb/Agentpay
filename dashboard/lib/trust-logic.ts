/**
 * PRODUCTION FIX — DEMO FLOW
 *
 * Pure logic functions for the TrustPaymentFlow.
 * Extracted so they can be tested without JSX / React dependencies.
 */

// PRODUCTION FIX — DEMO FLOW: Demo wallet lookup table for offline demo
export const DEMO_AGENT_SCORES: Record<string, { score: number; grade: string }> = {
  DemoAgentTrust850: { score: 850, grade: 'AAA' },
  DemoAgentNew300: { score: 300, grade: 'C' },
  DemoAgentSlash150: { score: 150, grade: 'F' },
};

export interface AgentRankLookup {
  score: number;
  grade: string;
}

// PRODUCTION FIX — DEMO FLOW: Look up agent score from demo wallet table
export function lookupAgentScore(walletAddress: string): AgentRankLookup | null {
  return DEMO_AGENT_SCORES[walletAddress] ?? null;
}

// PRODUCTION FIX — DEMO FLOW: Determine action based on AgentRank score
export function evaluateTrustDecision(
  score: number,
): 'proceed' | 'blocked' {
  if (score >= 700) return 'proceed';
  return 'blocked';
}
