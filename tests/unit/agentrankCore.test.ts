/**
 * Unit tests for agentrank-core — pure scoring engine.
 * No DB, no external dependencies.
 *
 * Tests cover: grade thresholds, scoring formula weights, Sybil detection,
 * Sybil penalty application, edge cases (zero inputs, max inputs).
 */

import {
  scoreToGrade,
  computeAgentRankScore,
  normaliseVolume,
  normaliseWalletAge,
  detectSybilFlags,
  applySybilPenalty,
  calculateAgentRank,
  type AgentRankFactors,
  type SybilSignals,
} from '../../src/reputation/agentrank-core';

const perfectFactors: AgentRankFactors = {
  paymentReliability: 1.0,
  serviceDelivery: 1.0,
  transactionVolume: 10000,
  walletAgeDays: 365,
  disputeRate: 0,
};

const zeroFactors: AgentRankFactors = {
  paymentReliability: 0,
  serviceDelivery: 0,
  transactionVolume: 0,
  walletAgeDays: 0,
  disputeRate: 1,
};

const cleanSybil: SybilSignals = {
  walletAgeDays: 30,
  stakeUsdc: 100,
  uniqueCounterparties: 10,
  circularTradingDetected: false,
};

describe('agentrank-core', () => {
  // ---------- scoreToGrade ----------
  describe('scoreToGrade', () => {
    it('returns S for score >= 950', () => {
      expect(scoreToGrade(950)).toBe('S');
      expect(scoreToGrade(1000)).toBe('S');
    });

    it('returns A for score 800–949', () => {
      expect(scoreToGrade(800)).toBe('A');
      expect(scoreToGrade(949)).toBe('A');
    });

    it('returns B for score 600–799', () => {
      expect(scoreToGrade(600)).toBe('B');
      expect(scoreToGrade(799)).toBe('B');
    });

    it('returns C for score 400–599', () => {
      expect(scoreToGrade(400)).toBe('C');
      expect(scoreToGrade(599)).toBe('C');
    });

    it('returns D for score 200–399', () => {
      expect(scoreToGrade(200)).toBe('D');
      expect(scoreToGrade(399)).toBe('D');
    });

    it('returns F for score 1–199', () => {
      expect(scoreToGrade(1)).toBe('F');
      expect(scoreToGrade(199)).toBe('F');
    });

    it('returns U for score of exactly 0', () => {
      expect(scoreToGrade(0)).toBe('U');
    });
  });

  // ---------- normaliseVolume ----------
  describe('normaliseVolume', () => {
    it('returns 0 for 0 transactions', () => {
      expect(normaliseVolume(0)).toBe(0);
    });

    it('returns a value between 0 and 1 for any positive count', () => {
      const v = normaliseVolume(100);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });

    it('returns 1.0 at or above the cap', () => {
      expect(normaliseVolume(1_000_000)).toBe(1);
    });

    it('increases monotonically', () => {
      expect(normaliseVolume(10)).toBeLessThan(normaliseVolume(100));
      expect(normaliseVolume(100)).toBeLessThan(normaliseVolume(10000));
    });
  });

  // ---------- normaliseWalletAge ----------
  describe('normaliseWalletAge', () => {
    it('returns 0 for 0 days', () => {
      expect(normaliseWalletAge(0)).toBe(0);
    });

    it('returns 1.0 at 365 days (cap)', () => {
      expect(normaliseWalletAge(365)).toBe(1);
    });

    it('returns 1.0 beyond 365 days', () => {
      expect(normaliseWalletAge(1000)).toBe(1);
    });

    it('returns a fraction for partial time', () => {
      const half = normaliseWalletAge(182);
      expect(half).toBeGreaterThan(0);
      expect(half).toBeLessThan(1);
    });
  });

  // ---------- computeAgentRankScore ----------
  describe('computeAgentRankScore', () => {
    it('returns 1000 for perfect factors', () => {
      expect(computeAgentRankScore(perfectFactors)).toBe(1000);
    });

    it('returns 0 for zero factors', () => {
      expect(computeAgentRankScore(zeroFactors)).toBe(0);
    });

    it('score is in [0, 1000] range', () => {
      const mixed: AgentRankFactors = {
        paymentReliability: 0.7,
        serviceDelivery: 0.6,
        transactionVolume: 500,
        walletAgeDays: 180,
        disputeRate: 0.1,
      };
      const score = computeAgentRankScore(mixed);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1000);
    });

    it('higher paymentReliability yields higher score', () => {
      const low = computeAgentRankScore({ ...zeroFactors, paymentReliability: 0.3 });
      const high = computeAgentRankScore({ ...zeroFactors, paymentReliability: 0.9 });
      expect(high).toBeGreaterThan(low);
    });

    it('lower disputeRate yields higher score', () => {
      const highDispute = computeAgentRankScore({ ...perfectFactors, disputeRate: 0.8 });
      const lowDispute = computeAgentRankScore({ ...perfectFactors, disputeRate: 0.1 });
      expect(lowDispute).toBeGreaterThan(highDispute);
    });
  });

  // ---------- detectSybilFlags ----------
  describe('detectSybilFlags', () => {
    it('returns no flags for a clean, established agent', () => {
      expect(detectSybilFlags(cleanSybil)).toHaveLength(0);
    });

    it('flags WALLET_TOO_NEW when wallet age < 7 days', () => {
      const flags = detectSybilFlags({ ...cleanSybil, walletAgeDays: 3 });
      expect(flags).toContain('WALLET_TOO_NEW');
    });

    it('flags INSUFFICIENT_STAKE when stake is below minimum', () => {
      const flags = detectSybilFlags({ ...cleanSybil, stakeUsdc: 0 });
      expect(flags).toContain('INSUFFICIENT_STAKE');
    });

    it('flags LOW_COUNTERPARTY_DIVERSITY with few unique counterparties', () => {
      const flags = detectSybilFlags({ ...cleanSybil, uniqueCounterparties: 0 });
      expect(flags).toContain('LOW_COUNTERPARTY_DIVERSITY');
    });

    it('flags CIRCULAR_TRADING when circular pattern detected', () => {
      const flags = detectSybilFlags({ ...cleanSybil, circularTradingDetected: true });
      expect(flags).toContain('CIRCULAR_TRADING');
    });

    it('can return multiple flags simultaneously', () => {
      const flags = detectSybilFlags({
        walletAgeDays: 1,
        stakeUsdc: 0,
        uniqueCounterparties: 0,
        circularTradingDetected: true,
      });
      expect(flags.length).toBe(4);
    });
  });

  // ---------- applySybilPenalty ----------
  describe('applySybilPenalty', () => {
    it('returns score unchanged when no flags', () => {
      expect(applySybilPenalty(500, [])).toBe(500);
    });

    it('applies 10% penalty per flag', () => {
      const penalized = applySybilPenalty(1000, ['FLAG_1']);
      expect(penalized).toBe(900);
    });

    it('applies 20% for two flags', () => {
      const penalized = applySybilPenalty(1000, ['F1', 'F2']);
      expect(penalized).toBe(800);
    });

    it('caps penalty at 50% regardless of flag count', () => {
      const penalized = applySybilPenalty(1000, ['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
      expect(penalized).toBe(500); // max 50% reduction
    });
  });

  // ---------- calculateAgentRank (integration) ----------
  describe('calculateAgentRank', () => {
    it('returns score, grade, factors, and sybilFlags', () => {
      const result = calculateAgentRank('agent-calc', perfectFactors, cleanSybil);
      expect(result.agentId).toBe('agent-calc');
      expect(result.score).toBeGreaterThan(0);
      expect(result.grade).toBeDefined();
      expect(Array.isArray(result.sybilFlags)).toBe(true);
      expect(result.factors).toEqual(perfectFactors);
    });

    it('penalizes new wallets in final score', () => {
      const newWallet = { ...cleanSybil, walletAgeDays: 1 };
      const established = { ...cleanSybil, walletAgeDays: 365 };
      const newer = calculateAgentRank('agent-new', perfectFactors, newWallet);
      const older = calculateAgentRank('agent-old', perfectFactors, established);
      expect(older.score).toBeGreaterThan(newer.score);
    });

    it('sybil flags are returned in result', () => {
      const badSybil: SybilSignals = {
        walletAgeDays: 1,
        stakeUsdc: 0,
        uniqueCounterparties: 0,
        circularTradingDetected: true,
      };
      const result = calculateAgentRank('agent-bad', perfectFactors, badSybil);
      expect(result.sybilFlags.length).toBeGreaterThan(0);
    });
  });
});