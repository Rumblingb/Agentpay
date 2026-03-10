// Mocks must come before imports. These integration tests require a live DB;
// this mock allows the module to load in CI (where DB is absent) so that
// the describeIfDb guard can skip tests gracefully instead of crashing.
jest.mock('../src/db/index', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  pool: { on: jest.fn() },
  closePool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    merchant: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    paymentIntent: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    transactions: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    agent: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    agentrank_scores: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  },
}));

import request from 'supertest';
import app from '../src/server';
import { closePool, query } from '../src/db/index';
import {
  computeTrustScore,
  computeDecayFactor,
  updateReputationOnVerification,
  getReputation,
  shouldFastTrack,
} from '../src/services/reputationService';

const dbAvailable = process.env.DB_AVAILABLE !== 'false';
const describeIfDb = dbAvailable ? describe : describe.skip;

let server: any;

beforeAll(async () => {
  server = app.listen(0);
  // Ensure clean state for agent_reputation table
  try {
    await query('DELETE FROM agent_reputation');
  } catch (e) {
    // Table may not exist in test env; skip
  }
});

afterAll(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await closePool();
});

describe('Reputation Service - Pure Functions', () => {
  describe('computeDecayFactor', () => {
    it('returns 1 when lastPaymentAt is null', () => {
      expect(computeDecayFactor(null)).toBe(1);
    });

    it('returns 1 for a payment made just now', () => {
      const factor = computeDecayFactor(new Date());
      expect(factor).toBeCloseTo(1, 3);
    });

    it('decays over time (40 days)', () => {
      const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      const factor = computeDecayFactor(fortyDaysAgo);
      // λ=0.005, t=40 → e^(-0.2) ≈ 0.819
      expect(factor).toBeGreaterThan(0.8);
      expect(factor).toBeLessThan(1);
    });

    it('decays more for older payments (100 days vs 10 days)', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      expect(computeDecayFactor(tenDaysAgo)).toBeGreaterThan(computeDecayFactor(hundredDaysAgo));
    });
  });

  describe('computeTrustScore', () => {
    it('returns 100 for perfect agent (no decay)', () => {
      const score = computeTrustScore(1, 0, new Date());
      expect(score).toBeCloseTo(100);
    });

    it('returns 0 for zero success rate', () => {
      expect(computeTrustScore(0, 0, new Date())).toBe(0);
    });

    it('reduces score when disputeRate is high', () => {
      const cleanScore = computeTrustScore(1, 0, new Date());
      const disputedScore = computeTrustScore(1, 0.5, new Date());
      expect(disputedScore).toBeLessThan(cleanScore);
    });

    it('clamps result to [0, 100]', () => {
      const score = computeTrustScore(2, 0, new Date()); // successRate > 1 (hypothetical)
      expect(score).toBeLessThanOrEqual(100);
      expect(score).toBeGreaterThanOrEqual(0);
    });

    it('applies decay for old lastPaymentAt', () => {
      const recentScore = computeTrustScore(1, 0, new Date());
      const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
      const decayedScore = computeTrustScore(1, 0, oldDate);
      expect(decayedScore).toBeLessThan(recentScore);
    });
  });

  describe('shouldFastTrack', () => {
    it('returns false for null reputation', () => {
      expect(shouldFastTrack(null)).toBe(false);
    });

    it('returns false for low trust score', () => {
      const rep = {
        agentId: 'a1',
        trustScore: 70,
        totalPayments: 20,
        successRate: 0.98,
        disputeRate: 0,
        lastPaymentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(shouldFastTrack(rep)).toBe(false);
    });

    it('returns false when totalPayments is too low', () => {
      const rep = {
        agentId: 'a1',
        trustScore: 90,
        totalPayments: 5,
        successRate: 0.98,
        disputeRate: 0,
        lastPaymentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(shouldFastTrack(rep)).toBe(false);
    });

    it('returns true for high-trust agent with enough payments', () => {
      const rep = {
        agentId: 'a1',
        trustScore: 90,
        totalPayments: 15,
        successRate: 0.97,
        disputeRate: 0,
        lastPaymentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(shouldFastTrack(rep)).toBe(true);
    });
  });
});

describeIfDb('Reputation Service - Database', () => {
  const testAgentId = `test-agent-${Date.now()}`;

  it('returns null for unknown agent', async () => {
    const rep = await getReputation('unknown-agent-xyz');
    expect(rep).toBeNull();
  });

  it('creates reputation record on first verification', async () => {
    const rep = await updateReputationOnVerification(testAgentId, true);
    expect(rep.agentId).toBe(testAgentId);
    expect(rep.totalPayments).toBe(1);
    expect(rep.successRate).toBe(1);
    expect(rep.trustScore).toBeGreaterThan(0);
  });

  it('increments totalPayments on subsequent verifications', async () => {
    await updateReputationOnVerification(testAgentId, true);
    const rep = await getReputation(testAgentId);
    expect(rep).not.toBeNull();
    expect(rep!.totalPayments).toBe(2);
  });

  it('reduces successRate on failed verification', async () => {
    await updateReputationOnVerification(testAgentId, false);
    const rep = await getReputation(testAgentId);
    expect(rep).not.toBeNull();
    expect(rep!.successRate).toBeLessThan(1);
    expect(rep!.totalPayments).toBe(3);
  });
});

describeIfDb('GET /api/agents/:agentId/reputation', () => {
  const knownAgentId = `get-test-agent-${Date.now()}`;

  beforeAll(async () => {
    await updateReputationOnVerification(knownAgentId, true);
    await updateReputationOnVerification(knownAgentId, true);
  });

  it('returns 404 for unknown agent', async () => {
    const res = await request(app).get('/api/agents/nonexistent-agent-abc/reputation');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('returns reputation for known agent', async () => {
    const res = await request(app).get(`/api/agents/${encodeURIComponent(knownAgentId)}/reputation`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reputation.agentId).toBe(knownAgentId);
    expect(res.body.reputation.totalPayments).toBe(2);
    expect(res.body.reputation.successRate).toBe(1);
    expect(res.body.reputation.trustScore).toBeGreaterThan(0);
    expect(res.body.fastTrackEligible).toBeDefined();
  });

  it('includes all expected reputation fields', async () => {
    const res = await request(app).get(`/api/agents/${encodeURIComponent(knownAgentId)}/reputation`);
    expect(res.status).toBe(200);
    const { reputation } = res.body;
    expect(reputation).toHaveProperty('agentId');
    expect(reputation).toHaveProperty('trustScore');
    expect(reputation).toHaveProperty('totalPayments');
    expect(reputation).toHaveProperty('successRate');
    expect(reputation).toHaveProperty('disputeRate');
    expect(reputation).toHaveProperty('lastPaymentAt');
    expect(reputation).toHaveProperty('createdAt');
    expect(reputation).toHaveProperty('updatedAt');
  });
});
