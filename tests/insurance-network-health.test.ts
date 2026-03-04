/**
 * PRODUCTION FIX — INSURANCE + NETWORK HEALTH TESTS
 *
 * 10+ new tests covering:
 *   1–5  Insurance trigger logic (computePayout, processCriticalAlertPure)
 *   6–10 NetworkHealthChart data helpers & edge cases
 *
 * Follows existing test conventions (Jest, ts-jest, no DB required).
 */

import {
  computePayout,
  processCriticalAlertPure,
  DEFAULT_REPUTATION_SLASH,
  type InsurancePoolRecord,
  type InsuranceClaimResult,
} from '../src/oracle/insurance-trigger';

import { DEFAULT_TVS_DATA } from '../src/data/network-health-data';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePool(overrides: Partial<InsurancePoolRecord> = {}): InsurancePoolRecord {
  return {
    id: 1,
    current_balance_usdc: 10_000,
    max_coverage_per_tx: 100,
    total_claims: 0,
    ...overrides,
  };
}

// ===========================================================================
// Insurance Trigger Tests
// ===========================================================================

describe('Insurance Trigger — computePayout', () => {
  // TEST 1
  it('pays max_coverage_per_tx when pool balance exceeds it', () => {
    const pool = makePool({ current_balance_usdc: 5000, max_coverage_per_tx: 100 });
    expect(computePayout(pool)).toBe(100);
  });

  // TEST 2
  it('pays the remaining balance when pool is lower than max_coverage_per_tx', () => {
    const pool = makePool({ current_balance_usdc: 42, max_coverage_per_tx: 100 });
    expect(computePayout(pool)).toBe(42);
  });

  // TEST 3
  it('returns 0 when pool balance is zero', () => {
    const pool = makePool({ current_balance_usdc: 0 });
    expect(computePayout(pool)).toBe(0);
  });

  // TEST 4
  it('returns 0 when pool balance is negative', () => {
    const pool = makePool({ current_balance_usdc: -5 });
    expect(computePayout(pool)).toBe(0);
  });
});

describe('Insurance Trigger — processCriticalAlertPure', () => {
  // TEST 5
  it('returns correct claim result with default reputation slash', () => {
    const pool = makePool();
    const result: InsuranceClaimResult = processCriticalAlertPure(
      'agent-bad-actor',
      'escrow-123',
      pool,
    );

    expect(result.agentId).toBe('agent-bad-actor');
    expect(result.escrowId).toBe('escrow-123');
    expect(result.reputationSlashed).toBe(DEFAULT_REPUTATION_SLASH);
    expect(result.payoutUsdc).toBe(100);
    expect(result.poolRemainingUsdc).toBe(9_900);
    expect(result.claimNumber).toBe(1);
  });

  // TEST 6
  it('increments claim number based on existing total_claims', () => {
    const pool = makePool({ total_claims: 7 });
    const result = processCriticalAlertPure('agent-x', 'escrow-456', pool);
    expect(result.claimNumber).toBe(8);
  });

  // TEST 7
  it('caps payout at remaining balance when pool is almost empty', () => {
    const pool = makePool({ current_balance_usdc: 30 });
    const result = processCriticalAlertPure('agent-y', 'escrow-789', pool);
    expect(result.payoutUsdc).toBe(30);
    expect(result.poolRemainingUsdc).toBe(0);
  });

  // TEST 8
  it('applies a custom reputation slash when provided', () => {
    const pool = makePool();
    const result = processCriticalAlertPure('agent-z', 'escrow-000', pool, 75);
    expect(result.reputationSlashed).toBe(75);
  });
});

// ===========================================================================
// Network Health Chart Tests
// ===========================================================================

describe('NetworkHealthChart — DEFAULT_TVS_DATA', () => {
  // TEST 9
  it('contains at least 3 data points', () => {
    expect(DEFAULT_TVS_DATA.length).toBeGreaterThanOrEqual(3);
  });

  // TEST 10
  it('ends with the current $454 TVS value', () => {
    const last = DEFAULT_TVS_DATA[DEFAULT_TVS_DATA.length - 1];
    expect(last.tvs).toBe(454);
  });

  // TEST 11
  it('has strictly increasing TVS values (healthy growth)', () => {
    for (let i = 1; i < DEFAULT_TVS_DATA.length; i++) {
      expect(DEFAULT_TVS_DATA[i].tvs).toBeGreaterThan(DEFAULT_TVS_DATA[i - 1].tvs);
    }
  });

  // TEST 12
  it('each data point has a non-empty name label', () => {
    DEFAULT_TVS_DATA.forEach((d) => {
      expect(d.name).toBeTruthy();
      expect(typeof d.name).toBe('string');
    });
  });
});
