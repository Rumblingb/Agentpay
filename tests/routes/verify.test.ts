/**
 * Route tests for GET /api/verify/:txHash
 *
 * Tests: valid hash lookup (confirmed + unconfirmed), invalid hash format,
 * HMAC signature presence, missing secret graceful error.
 */

process.env.WEBHOOK_SECRET = 'test-hmac-secret-for-verify-route';

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  pool: { on: jest.fn() },
  closePool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    merchant: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    paymentIntent: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    verificationCertificate: { create: jest.fn() },
    agentrank_scores: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    agent: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
  },
}));

import request from 'supertest';
import crypto from 'crypto';
import app from '../../src/server';
import * as db from '../../src/db/index';

const mockQuery = db.query as jest.Mock;

const VALID_SOLANA_HASH = '5W2v3RrRTXuCCZB8FrdQAuREf9JHMETVvHWw4rVSEGbgM1SjS5qw8ZAjS9Nqz7R';
const VALID_EVM_HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

describe('GET /api/verify/:txHash', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with verified:true for a confirmed transaction', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'intent-uuid',
        merchant_id: 'merchant-uuid',
        agent_id: 'agent-uuid',
        status: 'confirmed',
        created_at: new Date().toISOString(),
      }],
    });

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.intentId).toBe('intent-uuid');
    expect(res.body.merchantId).toBe('merchant-uuid');
    expect(res.body.agentId).toBe('agent-uuid');
  });

  it('returns verified:false for a pending transaction', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'intent-uuid',
        merchant_id: 'merchant-uuid',
        agent_id: null,
        status: 'pending',
        created_at: new Date().toISOString(),
      }],
    });

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
  });

  it('returns verified:false with null ids when transaction not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.intentId).toBeNull();
  });

  it('includes an HMAC signature in the response', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('signature');
    expect(typeof res.body.signature).toBe('string');
    expect(res.body.signature.length).toBeGreaterThan(0);
  });

  it('signature is valid HMAC-SHA256 of the payload', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/api/verify/${VALID_EVM_HASH}`);
    const { signature, ...payload } = res.body;
    const expectedSig = crypto
      .createHmac('sha256', 'test-hmac-secret-for-verify-route')
      .update(JSON.stringify(payload))
      .digest('hex');
    expect(signature).toBe(expectedSig);
  });

  it('returns 400 for a txHash that is too short', async () => {
    const res = await request(app).get('/api/verify/short');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid');
  });

  it('returns 400 for a txHash with special characters (injection attempt)', async () => {
    const res = await request(app).get('/api/verify/' + encodeURIComponent("'; DROP TABLE--"));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an excessively long txHash', async () => {
    const longHash = 'a'.repeat(200);
    const res = await request(app).get(`/api/verify/${longHash}`);
    expect(res.status).toBe(400);
  });

  it('returns 500 when WEBHOOK_SECRET is missing', async () => {
    const savedSecret = process.env.WEBHOOK_SECRET;
    delete process.env.WEBHOOK_SECRET;
    delete process.env.AGENTPAY_HMAC_SECRET;
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(500);

    process.env.WEBHOOK_SECRET = savedSecret;
  });

  it('accepts EVM-style hex hash (64 chars)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/api/verify/${VALID_EVM_HASH}`);
    expect(res.status).toBe(200);
  });
});