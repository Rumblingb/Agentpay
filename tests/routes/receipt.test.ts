/**
 * Route tests for GET /api/receipt/:intentId
 *
 * Tests: successful receipt fetch, not-found, verificationToken exclusion,
 * sanitizeIntent integration, rate-limiting headers.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  pool: { on: jest.fn() },
  closePool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    merchant: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    paymentIntent: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    verificationCertificate: { create: jest.fn() },
    agentrank_scores: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    agent: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
  },
}));

import request from 'supertest';
import app from '../../src/server';
import prisma from '../../src/lib/prisma';

const mockFindUnique = prisma.paymentIntent.findUnique as jest.Mock;

const MOCK_INTENT = {
  id: 'intent-uuid-receipt-001',
  amount: '15.50',
  currency: 'USDC',
  status: 'confirmed',
  protocol: 'ap2',
  agentId: 'agent-uuid-001',
  verificationToken: 'THIS-MUST-NOT-APPEAR-IN-RESPONSE',
  expiresAt: new Date('2030-01-01T00:00:00Z'),
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  agent: {
    id: 'agent-uuid-001',
    displayName: 'DataBot',
    riskScore: 5,
  },
};

describe('GET /api/receipt/:intentId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with intent data for a valid intentId', async () => {
    mockFindUnique.mockResolvedValueOnce(MOCK_INTENT);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT.id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.intent.id).toBe(MOCK_INTENT.id);
    expect(res.body.intent.status).toBe('confirmed');
  });

  it('NEVER exposes verificationToken in the response', async () => {
    mockFindUnique.mockResolvedValueOnce(MOCK_INTENT);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT.id}`);

    expect(res.status).toBe(200);
    // Check recursively — token must not appear anywhere
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('THIS-MUST-NOT-APPEAR-IN-RESPONSE');
    expect(bodyStr).not.toContain('verificationToken');
  });

  it('includes agent info in the response', async () => {
    mockFindUnique.mockResolvedValueOnce(MOCK_INTENT);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT.id}`);

    expect(res.body.intent.agent).toBeDefined();
    expect(res.body.intent.agent.displayName).toBe('DataBot');
  });

  it('returns null agent when intent has no agent', async () => {
    const intentWithoutAgent = { ...MOCK_INTENT, agentId: null, agent: null };
    mockFindUnique.mockResolvedValueOnce(intentWithoutAgent);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT.id}`);

    expect(res.status).toBe(200);
    expect(res.body.intent.agent).toBeNull();
  });

  it('returns 404 for non-existent intentId', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/receipt/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('returns escrow:null in the response (future feature placeholder)', async () => {
    mockFindUnique.mockResolvedValueOnce(MOCK_INTENT);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT.id}`);

    expect(res.body.escrow).toBeNull();
  });

  it('returns 500 on DB error', async () => {
    mockFindUnique.mockRejectedValueOnce(new Error('DB connection lost'));
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT.id}`);

    expect(res.status).toBe(500);
  });

  it('converts amount to number in response', async () => {
    mockFindUnique.mockResolvedValueOnce(MOCK_INTENT);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT.id}`);

    expect(typeof res.body.intent.amount).toBe('number');
    expect(res.body.intent.amount).toBe(15.5);
  });

  it('exposes timestamps as ISO strings', async () => {
    mockFindUnique.mockResolvedValueOnce(MOCK_INTENT);
    const res = await request(app).get(`/api/receipt/${MOCK_INTENT.id}`);

    expect(typeof res.body.intent.expiresAt).toBe('string');
    expect(res.body.intent.expiresAt).toContain('T');
  });
});
