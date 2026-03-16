/**
 * Sybil Resistance Engine — Dedicated module to prevent wash trading,
 * fake reputation, and Sybil attacks in the AgentRank ecosystem.
 *
 * Defenses:
 *   1. Wallet Age Weighting   — score 0-1 based on wallet creation date
 *   2. Stake Requirement      — must lock $100 USDC minimum to start
 *   3. Social Graph Analysis  — unique counterparty diversity check
 *   4. Transaction Pattern    — circular trading detection (A→B→A)
 *   5. Velocity Limits        — max transactions per day cap
 *
 * @module sybil-resistance
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SybilDefenses {
  /** 0–1 score based on wallet creation date (older = higher) */
  walletAgeScore: number;
  /** Minimum USDC stake required to participate */
  minStakeUsdc: number;
  /** Number of different agents this agent has transacted with */
  uniqueCounterparties: number;
  /** Whether circular trading patterns (A→B→A) were detected */
  circularTradingDetected: boolean;
  /** Maximum transactions allowed per 24-hour period */
  maxTransactionsPerDay: number;
}

export interface WalletProfile {
  walletAddress: string;
  createdAt: Date;
  stakedUsdc: number;
  counterparties: string[];
  transactionsToday: number;
  transactionHistory: TransactionEdge[];
}

export interface TransactionEdge {
  from: string;
  to: string;
  amount: number;
  timestamp: Date;
}

export interface SybilCheckResult {
  passed: boolean;
  defenses: SybilDefenses;
  flags: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum USDC stake to participate in the reputation system */
const MIN_STAKE_USDC = 100;

/** Maximum transactions per day before velocity limit triggers */
const MAX_TRANSACTIONS_PER_DAY = 50;

/** Minimum wallet age (days) for full trust */
const FULL_TRUST_WALLET_AGE_DAYS = 90;

/** Minimum unique counterparties to avoid suspicion */
const MIN_COUNTERPARTIES = 3;

/** Minimum round-trip count to flag as circular trading */
const CIRCULAR_TRADE_THRESHOLD = 2;

// ---------------------------------------------------------------------------
// Pure scoring functions
// ---------------------------------------------------------------------------

/**
 * Compute wallet age score (0–1).
 * Wallets less than 1 day old get 0. Full credit at FULL_TRUST_WALLET_AGE_DAYS.
 */
export function computeWalletAgeScore(walletCreatedAt: Date): number {
  const ageDays = (Date.now() - walletCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < 1) return 0;
  return Math.min(1, ageDays / FULL_TRUST_WALLET_AGE_DAYS);
}

/**
 * Check whether the agent meets the minimum stake requirement.
 */
export function meetsStakeRequirement(stakedUsdc: number): boolean {
  return stakedUsdc >= MIN_STAKE_USDC;
}

/**
 * Analyse counterparty diversity — returns a 0–1 score.
 * Fewer unique counterparties → lower score.
 */
export function computeCounterpartyDiversityScore(uniqueCounterparties: number): number {
  if (uniqueCounterparties <= 0) return 0;
  if (uniqueCounterparties >= 10) return 1;
  return uniqueCounterparties / 10;
}

/**
 * Detect circular trading patterns (A→B→A round-trips).
 * Returns true if the number of round-trips meets or exceeds the threshold.
 */
export function detectCircularTrading(
  walletAddress: string,
  history: TransactionEdge[],
): boolean {
  // Build directed edge counts per counterparty
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();

  for (const tx of history) {
    if (tx.from === walletAddress) {
      outgoing.set(tx.to, (outgoing.get(tx.to) || 0) + 1);
    }
    if (tx.to === walletAddress) {
      incoming.set(tx.from, (incoming.get(tx.from) || 0) + 1);
    }
  }

  // A round-trip exists when the same counterparty appears in both outgoing and incoming
  let roundTrips = 0;
  for (const [counterparty, outCount] of outgoing) {
    const inCount = incoming.get(counterparty) || 0;
    roundTrips += Math.min(outCount, inCount);
  }

  return roundTrips >= CIRCULAR_TRADE_THRESHOLD;
}

/**
 * Check velocity limits — whether the agent has exceeded the daily tx cap.
 */
export function exceedsVelocityLimit(transactionsToday: number): boolean {
  return transactionsToday > MAX_TRANSACTIONS_PER_DAY;
}

/**
 * Map flags to an overall risk level.
 */
export function computeRiskLevel(flags: string[]): 'low' | 'medium' | 'high' | 'critical' {
  if (flags.length === 0) return 'low';
  if (flags.length === 1) return 'medium';
  if (flags.length <= 3) return 'high';
  return 'critical';
}

// ---------------------------------------------------------------------------
// Main Sybil check
// ---------------------------------------------------------------------------

/**
 * Run the full Sybil resistance check for a wallet.
 */
export function runSybilCheck(profile: WalletProfile): SybilCheckResult {
  const flags: string[] = [];

  // 1. Wallet age
  const walletAgeScore = computeWalletAgeScore(profile.createdAt);
  if (walletAgeScore < 0.1) {
    flags.push('WALLET_TOO_NEW');
  }

  // 2. Stake requirement
  const stakeMet = meetsStakeRequirement(profile.stakedUsdc);
  if (!stakeMet) {
    flags.push('INSUFFICIENT_STAKE');
  }

  // 3. Social graph — counterparty diversity
  const uniqueCounterparties = new Set(profile.counterparties).size;
  if (uniqueCounterparties < MIN_COUNTERPARTIES) {
    flags.push('LOW_COUNTERPARTY_DIVERSITY');
  }

  // 4. Circular trading detection
  const circularTradingDetected = detectCircularTrading(
    profile.walletAddress,
    profile.transactionHistory,
  );
  if (circularTradingDetected) {
    flags.push('CIRCULAR_TRADING_DETECTED');
  }

  // 5. Velocity limits
  if (exceedsVelocityLimit(profile.transactionsToday)) {
    flags.push('VELOCITY_LIMIT_EXCEEDED');
  }

  const riskLevel = computeRiskLevel(flags);

  const defenses: SybilDefenses = {
    walletAgeScore,
    minStakeUsdc: MIN_STAKE_USDC,
    uniqueCounterparties,
    circularTradingDetected,
    maxTransactionsPerDay: MAX_TRANSACTIONS_PER_DAY,
  };

  return {
    passed: flags.length === 0,
    defenses,
    flags,
    riskLevel,
  };
}
