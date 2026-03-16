/**
 * AgentRank-Core — Weighted scoring engine for agent reputation.
 *
 * Scoring formula (0–1000 scale):
 *   - Payment reliability:   40%  (successful payments / total payments)
 *   - Service delivery:      30%  (completed escrows / total escrows)
 *   - Transaction volume:    15%  (log-scaled tx count)
 *   - Wallet age:            10%  (days since first seen, capped at 365)
 *   - Dispute rate:           5%  (inverse — lower disputes = higher score)
 *
 * Sybil resistance:
 *   - Wallet age weighting (new wallets are penalised)
 *   - Minimum stake requirement (must hold ≥ configurable USDC)
 *   - Unique counterparties check (diverse trading partners)
 *   - Circular trading detection (A→B→A patterns)
 *
 * Prisma migration comment — run the SQL below to create the table:
 *
 *   CREATE TABLE IF NOT EXISTS agentrank_scores (
 *     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     agent_id      TEXT UNIQUE NOT NULL,
 *     score         INT NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 1000),
 *     grade         TEXT NOT NULL DEFAULT 'U',
 *     payment_reliability NUMERIC(5,4) NOT NULL DEFAULT 0,
 *     service_delivery    NUMERIC(5,4) NOT NULL DEFAULT 0,
 *     transaction_volume  INT NOT NULL DEFAULT 0,
 *     wallet_age_days     INT NOT NULL DEFAULT 0,
 *     dispute_rate        NUMERIC(5,4) NOT NULL DEFAULT 0,
 *     stake_usdc          NUMERIC(20,6) NOT NULL DEFAULT 0,
 *     unique_counterparties INT NOT NULL DEFAULT 0,
 *     factors             JSONB DEFAULT '{}',
 *     history             JSONB DEFAULT '[]',
 *     created_at          TIMESTAMPTZ DEFAULT NOW(),
 *     updated_at          TIMESTAMPTZ DEFAULT NOW()
 *   );
 *
 * @module agentrank-core
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentRankFactors {
  paymentReliability: number; // 0–1
  serviceDelivery: number;    // 0–1
  transactionVolume: number;  // raw count
  walletAgeDays: number;      // days
  disputeRate: number;        // 0–1 (lower is better)
}

export interface SybilSignals {
  walletAgeDays: number;
  stakeUsdc: number;
  uniqueCounterparties: number;
  circularTradingDetected: boolean;
}

export interface AgentRankResult {
  agentId: string;
  score: number;   // 0–1000
  grade: string;   // S / A / B / C / D / F / U
  factors: AgentRankFactors;
  sybilFlags: string[];
}

export type AgentRankHistoryEntry = {
  score: number;
  timestamp: string;
  reason: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEIGHTS = {
  paymentReliability: 0.40,
  serviceDelivery: 0.30,
  transactionVolume: 0.15,
  walletAge: 0.10,
  disputeRate: 0.05,
} as const;

/** Minimum stake (USDC) to avoid Sybil penalty */
const MIN_STAKE_USDC = 10;

/** Minimum unique counterparties to avoid Sybil penalty */
const MIN_UNIQUE_COUNTERPARTIES = 3;

/** Maximum wallet age days for full credit (365) */
const MAX_WALLET_AGE_DAYS = 365;

/** Transaction volume is log-scaled; this caps the normalised value */
const VOLUME_LOG_CAP = 1000;

// ---------------------------------------------------------------------------
// Pure scoring functions (no DB dependency — fully testable)
// ---------------------------------------------------------------------------

/**
 * Normalise transaction volume on a log scale (0–1).
 */
export function normaliseVolume(txCount: number): number {
  if (txCount <= 0) return 0;
  return Math.min(1, Math.log10(txCount + 1) / Math.log10(VOLUME_LOG_CAP + 1));
}

/**
 * Normalise wallet age (0–1). Capped at MAX_WALLET_AGE_DAYS.
 */
export function normaliseWalletAge(days: number): number {
  if (days <= 0) return 0;
  return Math.min(1, days / MAX_WALLET_AGE_DAYS);
}

/**
 * Compute a raw 0–1000 AgentRank score from individual factors.
 */
export function computeAgentRankScore(factors: AgentRankFactors): number {
  const paymentComponent = Math.max(0, Math.min(1, factors.paymentReliability)) * WEIGHTS.paymentReliability;
  const deliveryComponent = Math.max(0, Math.min(1, factors.serviceDelivery)) * WEIGHTS.serviceDelivery;
  const volumeComponent = normaliseVolume(factors.transactionVolume) * WEIGHTS.transactionVolume;
  const ageComponent = normaliseWalletAge(factors.walletAgeDays) * WEIGHTS.walletAge;
  // Dispute rate is inverse — 0 disputes = full credit
  const disputeComponent = Math.max(0, 1 - Math.min(1, factors.disputeRate)) * WEIGHTS.disputeRate;

  const raw = paymentComponent + deliveryComponent + volumeComponent + ageComponent + disputeComponent;
  return Math.round(raw * 1000);
}

/**
 * Map a numeric score (0–1000) to a letter grade.
 */
export function scoreToGrade(score: number): string {
  if (score >= 950) return 'S';
  if (score >= 800) return 'A';
  if (score >= 600) return 'B';
  if (score >= 400) return 'C';
  if (score >= 200) return 'D';
  if (score > 0)    return 'F';
  return 'U'; // Unranked
}

/**
 * Detect Sybil-like signals and return a list of flag strings.
 */
export function detectSybilFlags(signals: SybilSignals): string[] {
  const flags: string[] = [];
  if (signals.walletAgeDays < 7) {
    flags.push('WALLET_TOO_NEW');
  }
  if (signals.stakeUsdc < MIN_STAKE_USDC) {
    flags.push('INSUFFICIENT_STAKE');
  }
  if (signals.uniqueCounterparties < MIN_UNIQUE_COUNTERPARTIES) {
    flags.push('LOW_COUNTERPARTY_DIVERSITY');
  }
  if (signals.circularTradingDetected) {
    flags.push('CIRCULAR_TRADING');
  }
  return flags;
}

/**
 * Apply Sybil penalty — each flag reduces the score by 10 %.
 */
export function applySybilPenalty(score: number, flags: string[]): number {
  if (flags.length === 0) return score;
  const penalty = Math.min(flags.length * 0.10, 0.50); // max 50 % reduction
  return Math.round(score * (1 - penalty));
}

/**
 * Full AgentRank calculation — combines factor scoring + Sybil resistance.
 */
export function calculateAgentRank(
  agentId: string,
  factors: AgentRankFactors,
  sybilSignals: SybilSignals,
): AgentRankResult {
  const rawScore = computeAgentRankScore(factors);
  const sybilFlags = detectSybilFlags(sybilSignals);
  const finalScore = applySybilPenalty(rawScore, sybilFlags);
  const grade = scoreToGrade(finalScore);

  return {
    agentId,
    score: finalScore,
    grade,
    factors,
    sybilFlags,
  };
}
