/**
 * Tests for the spending policy enforcement middleware.
 * Tests the pure `checkPolicy` function directly (no DB needed).
 */

import { describe, it, expect } from '@jest/globals';
import { checkPolicy, type SpendingPolicyConfig } from '../../src/middleware/spendingPolicy';

const BASE_POLICY: SpendingPolicyConfig = {
  perTxLimitCents: 10000,        // $100
  dailyLimitCents: 100000,       // $1,000
  autoApproveUnderCents: 500,    // $5
  minAgentRank: 0,
  allowedRecipients: [],
};

describe('checkPolicy', () => {
  it('allows a payment within all limits', () => {
    const result = checkPolicy(5000, 'agent-x', 700, 10000, BASE_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.autoApproved).toBe(false); // 5000 > 500 so not auto-approved
  });

  it('auto-approves payments at or below autoApproveUnderCents', () => {
    const result = checkPolicy(500, 'agent-x', 700, 0, BASE_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.autoApproved).toBe(true);
  });

  it('rejects when amount exceeds perTxLimitCents', () => {
    const result = checkPolicy(15000, 'agent-x', 700, 0, BASE_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/per-transaction limit/i);
  });

  it('rejects when cumulative daily spend would exceed dailyLimitCents', () => {
    // todaySpent = 95000, new payment = 10000 → would be 105000 > 100000
    const result = checkPolicy(10000, 'agent-x', 700, 95000, BASE_POLICY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/daily limit/i);
    expect(result.remainingDailyCents).toBe(5000); // 100000 - 95000
  });

  it('rejects when recipient is not in allowlist', () => {
    const policy: SpendingPolicyConfig = {
      ...BASE_POLICY,
      allowedRecipients: ['agent-allowed-001'],
    };
    const result = checkPolicy(100, 'agent-blocked', undefined, 0, policy);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/allowlist/i);
  });

  it('allows payment to allowlisted recipient', () => {
    const policy: SpendingPolicyConfig = {
      ...BASE_POLICY,
      allowedRecipients: ['agent-allowed-001'],
    };
    const result = checkPolicy(100, 'agent-allowed-001', undefined, 0, policy);
    expect(result.allowed).toBe(true);
  });

  it('allows any recipient when allowedRecipients is empty', () => {
    const result = checkPolicy(100, 'any-recipient', undefined, 0, BASE_POLICY);
    expect(result.allowed).toBe(true);
  });

  it('rejects when AgentRank is below minimum', () => {
    const policy: SpendingPolicyConfig = {
      ...BASE_POLICY,
      minAgentRank: 500,
    };
    const result = checkPolicy(100, undefined, 300, 0, policy);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/AgentRank/i);
  });

  it('allows when AgentRank meets minimum', () => {
    const policy: SpendingPolicyConfig = {
      ...BASE_POLICY,
      minAgentRank: 500,
    };
    const result = checkPolicy(100, undefined, 500, 0, policy);
    expect(result.allowed).toBe(true);
  });

  it('skips AgentRank check when agentRankScore is undefined', () => {
    const policy: SpendingPolicyConfig = {
      ...BASE_POLICY,
      minAgentRank: 500,
    };
    // No agentRankScore provided — should allow (we don't have rank data yet)
    const result = checkPolicy(100, undefined, undefined, 0, policy);
    expect(result.allowed).toBe(true);
  });

  it('skips AgentRank check when minAgentRank is 0', () => {
    const result = checkPolicy(100, undefined, 50, 0, BASE_POLICY); // rank=50, min=0
    expect(result.allowed).toBe(true);
  });

  it('calculates remaining daily budget correctly', () => {
    // todaySpent=30000, amount=5000, daily limit=100000 → remaining=65000
    const result = checkPolicy(5000, undefined, undefined, 30000, BASE_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.remainingDailyCents).toBe(65000);
  });

  it('checks per-tx limit before daily limit', () => {
    // perTx=10000, amount=15000 → should fail on per-tx, not daily
    const result = checkPolicy(15000, undefined, undefined, 0, BASE_POLICY);
    expect(result.reason).toMatch(/per-transaction/i);
  });

  it('handles zero amount (free operations)', () => {
    const result = checkPolicy(0, undefined, undefined, 0, BASE_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.autoApproved).toBe(true); // 0 <= 500
  });
});
