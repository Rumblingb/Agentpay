/**
 * Unit tests for KYA-Gateway — Know Your Agent risk scoring and identity management.
 * Uses the in-memory store (no DB). Tests cover:
 *   - Registration validation
 *   - Duplicate prevention
 *   - Auto-verification logic
 *   - Risk score computation
 *   - Lookup and verify
 */

import {
  registerKya,
  getKya,
  verifyKya,
  computeRiskScore,
  _resetStore,
} from '../../src/identity/kya-gateway';

describe('kya-gateway', () => {
  beforeEach(() => _resetStore());

  // ---------- computeRiskScore ----------
  describe('computeRiskScore', () => {
    it('starts at base risk of 50 with no verification', () => {
      expect(computeRiskScore({})).toBe(50);
    });

    it('reduces score by 20 when verified', () => {
      expect(computeRiskScore({ verified: true })).toBe(30);
    });

    it('reduces score by 15 when stripeAccount provided', () => {
      expect(computeRiskScore({ stripeAccount: 'acct_123' })).toBe(35);
    });

    it('reduces score by 10 when platformToken provided', () => {
      expect(computeRiskScore({ platformToken: 'tok_abc' })).toBe(40);
    });

    it('reduces score by 5 when worldIdHash provided', () => {
      expect(computeRiskScore({ worldIdHash: 'hash_xyz' })).toBe(45);
    });

    it('fully verified identity has minimum risk', () => {
      const score = computeRiskScore({
        verified: true,
        stripeAccount: 'acct_123',
        platformToken: 'tok_abc',
        worldIdHash: 'hash_xyz',
      });
      expect(score).toBe(0); // 50 - 20 - 15 - 10 - 5 = 0
    });

    it('never goes below 0', () => {
      const score = computeRiskScore({
        verified: true,
        stripeAccount: 'acct',
        platformToken: 'tok',
        worldIdHash: 'wid',
      });
      expect(score).toBeGreaterThanOrEqual(0);
    });

    it('never exceeds 100', () => {
      expect(computeRiskScore({})).toBeLessThanOrEqual(100);
    });
  });

  // ---------- registerKya ----------
  describe('registerKya', () => {
    it('returns a KyaIdentity with the provided fields', () => {
      const identity = registerKya({
        agentId: 'agent-001',
        ownerEmail: 'owner@example.com',
      });
      expect(identity.agentId).toBe('agent-001');
      expect(identity.ownerEmail).toBe('owner@example.com');
    });

    it('assigns a unique ID to each registration', () => {
      const a = registerKya({ agentId: 'agent-a', ownerEmail: 'a@example.com' });
      const b = registerKya({ agentId: 'agent-b', ownerEmail: 'b@example.com' });
      expect(a.id).not.toBe(b.id);
    });

    it('starts with kycStatus = pending when not fully verified', () => {
      const identity = registerKya({ agentId: 'agent-p', ownerEmail: 'p@example.com' });
      expect(identity.kycStatus).toBe('pending');
      expect(identity.verified).toBe(false);
    });

    it('auto-verifies when both stripeAccount and platformToken provided', () => {
      const identity = registerKya({
        agentId: 'agent-v',
        ownerEmail: 'v@example.com',
        stripeAccount: 'acct_abc',
        platformToken: 'tok_xyz',
      });
      expect(identity.verified).toBe(true);
      expect(identity.kycStatus).toBe('verified');
    });

    it('does NOT auto-verify with only stripeAccount', () => {
      const identity = registerKya({
        agentId: 'agent-half',
        ownerEmail: 'half@example.com',
        stripeAccount: 'acct_abc',
      });
      expect(identity.verified).toBe(false);
    });

    it('does NOT auto-verify with only platformToken', () => {
      const identity = registerKya({
        agentId: 'agent-half2',
        ownerEmail: 'half2@example.com',
        platformToken: 'tok_xyz',
      });
      expect(identity.verified).toBe(false);
    });

    it('throws when agentId is missing', () => {
      expect(() =>
        registerKya({ agentId: '', ownerEmail: 'owner@example.com' })
      ).toThrow('agentId is required');
    });

    it('throws for invalid email format', () => {
      expect(() =>
        registerKya({ agentId: 'agent-bad', ownerEmail: 'not-an-email' })
      ).toThrow('Invalid email format');
    });

    it('throws when duplicate agentId is registered', () => {
      registerKya({ agentId: 'agent-dup', ownerEmail: 'a@example.com' });
      expect(() =>
        registerKya({ agentId: 'agent-dup', ownerEmail: 'b@example.com' })
      ).toThrow('Agent is already registered');
    });

    it('computes riskScore on registration', () => {
      const identity = registerKya({ agentId: 'agent-risk', ownerEmail: 'r@example.com' });
      expect(typeof identity.riskScore).toBe('number');
      expect(identity.riskScore).toBeGreaterThanOrEqual(0);
    });

    it('sets createdAt and updatedAt timestamps', () => {
      const before = new Date();
      const identity = registerKya({ agentId: 'agent-ts', ownerEmail: 'ts@example.com' });
      const after = new Date();
      expect(identity.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(identity.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  // ---------- getKya ----------
  describe('getKya', () => {
    it('returns null for non-existent agentId', () => {
      expect(getKya('nobody')).toBeNull();
    });

    it('returns the registered identity', () => {
      registerKya({ agentId: 'agent-get', ownerEmail: 'get@example.com' });
      const identity = getKya('agent-get');
      expect(identity).not.toBeNull();
      expect(identity!.agentId).toBe('agent-get');
    });
  });

  // ---------- verifyKya ----------
  describe('verifyKya', () => {
    it('marks agent as verified and sets kycStatus to verified', () => {
      registerKya({ agentId: 'agent-vkya', ownerEmail: 'vkya@example.com' });
      const updated = verifyKya('agent-vkya');
      expect(updated.verified).toBe(true);
      expect(updated.kycStatus).toBe('verified');
    });

    it('recalculates riskScore after verification', () => {
      registerKya({ agentId: 'agent-vrisk', ownerEmail: 'vrisk@example.com' });
      const before = getKya('agent-vrisk')!.riskScore;
      const after = verifyKya('agent-vrisk').riskScore;
      expect(after).toBeLessThan(before); // verified reduces risk
    });

    it('throws when agent not found', () => {
      expect(() => verifyKya('nonexistent')).toThrow('KYA identity not found');
    });

    it('updates updatedAt on verification', () => {
      registerKya({ agentId: 'agent-upd', ownerEmail: 'upd@example.com' });
      const before = getKya('agent-upd')!.updatedAt;
      const after = verifyKya('agent-upd').updatedAt;
      expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });
});