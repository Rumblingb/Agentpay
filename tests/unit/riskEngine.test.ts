/**
 * Unit tests for riskEngine — aggregated risk assessment.
 * No DB mocks needed; sybil-resistance and behavioral-oracle are in-memory.
 */

import { assessRisk, shouldBlock } from '../../src/services/riskEngine';

describe('riskEngine', () => {
  describe('assessRisk', () => {
    it('flags self-hire as CRITICAL with riskScore=100', async () => {
      const result = await assessRisk({
        agentId: 'agent-a',
        counterpartyId: 'agent-a',
        transactionType: 'hire',
      });

      expect(result.riskScore).toBe(100);
      expect(result.riskTier).toBe('CRITICAL');
      expect(result.flags).toContain('SELF_HIRE');
      expect(result.actions).toContain('block_job');
    });

    it('returns MEDIUM or lower tier for a clean agent with no profile data', async () => {
      const result = await assessRisk({
        agentId: 'safe-agent-xyz',
        transactionType: 'hire',
      });

      // A brand-new wallet with no stake gets sybil flags (WALLET_TOO_NEW, etc.)
      // which raises the score to MEDIUM. Confirm it is not CRITICAL/HIGH.
      expect(['LOW', 'MEDIUM']).toContain(result.riskTier);
      expect(result.riskScore).toBeLessThanOrEqual(50);
    });

    it('returns an assessedAt date', async () => {
      const before = Date.now();
      const result = await assessRisk({
        agentId: 'test-agent',
        transactionType: 'job_create',
      });
      expect(result.assessedAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('includes agentId in the result', async () => {
      const result = await assessRisk({
        agentId: 'my-agent-id',
        transactionType: 'hire',
      });
      expect(result.agentId).toBe('my-agent-id');
    });
  });

  describe('shouldBlock', () => {
    it('returns true for self-hire', async () => {
      const blocked = await shouldBlock({
        agentId: 'agent-x',
        counterpartyId: 'agent-x',
        transactionType: 'hire',
      });
      expect(blocked).toBe(true);
    });

    it('returns false for a clean agent (no self-hire, no critical flags)', async () => {
      // A clean agent may still get sybil warnings (WALLET_TOO_NEW etc.) which
      // puts it in MEDIUM tier — shouldBlock only triggers on block_job / freeze_agent
      // actions, which require HIGH or CRITICAL tier.
      const blocked = await shouldBlock({
        agentId: 'clean-agent-abc',
        transactionType: 'hire',
      });
      expect(blocked).toBe(false);
    });
  });
});
