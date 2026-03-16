/**
 * Route tests for /api/agent-identity — register, update, verify-pin.
 * DB is mocked. bcrypt is mocked for speed.
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
    paymentIntent: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    verificationCertificate: { create: jest.fn() },
    agentrank_scores: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    agent: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
  },
}));

jest.mock('../../src/services/agentIdentityService', () => ({
  registerAgent: jest.fn(),
  updateAgent: jest.fn(),
  verifyPin: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  authenticateApiKey: (_req: any, _res: any, next: any) => {
    _req.merchant = { id: 'merchant-001', name: 'Test', email: 't@t.com', walletAddress: 'wa' };
    next();
  },
}));

import request from 'supertest';
import app from '../../src/server';
import * as agentIdentityService from '../../src/services/agentIdentityService';

const mockRegister = agentIdentityService.registerAgent as jest.Mock;
const mockUpdate = agentIdentityService.updateAgent as jest.Mock;
const mockVerifyPin = agentIdentityService.verifyPin as jest.Mock;

// NOTE: POST /api/agents/register is handled by the agentsRouter (marketplace registration)
// which is mounted first at /api/agents. agentIdentityRouter.POST /register is only
// reachable via the agentIdentityService directly. The PATCH /update and POST /verify-pin
// endpoints below ARE unique to agentIdentityRouter and fully reachable.

describe('PATCH /api/agents/update', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 on successful update', async () => {
    mockUpdate.mockResolvedValueOnce(undefined);
    const res = await request(app)
      .patch('/api/agents/update')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ agentId: '550e8400-e29b-41d4-a716-446655440000', agentPublicKey: 'new-pk' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 when agentId is not a UUID', async () => {
    const res = await request(app)
      .patch('/api/agents/update')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ agentId: 'not-a-uuid', agentPublicKey: 'pk' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when agentId is missing', async () => {
    const res = await request(app)
      .patch('/api/agents/update')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ agentPublicKey: 'pk' });
    expect(res.status).toBe(400);
  });

  it('returns 500 on service error', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app)
      .patch('/api/agents/update')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ agentId: '550e8400-e29b-41d4-a716-446655440000' });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/agents/verify-pin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 verified:true for correct PIN', async () => {
    mockVerifyPin.mockResolvedValueOnce(true);
    const res = await request(app)
      .post('/api/agents/verify-pin')
      .send({ agentId: '550e8400-e29b-41d4-a716-446655440000', pin: '1234' });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
  });

  it('returns 401 for incorrect PIN', async () => {
    mockVerifyPin.mockResolvedValueOnce(false);
    const res = await request(app)
      .post('/api/agents/verify-pin')
      .send({ agentId: '550e8400-e29b-41d4-a716-446655440000', pin: '0000' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid PIN');
  });

  it('returns 400 when agentId is not a UUID', async () => {
    const res = await request(app)
      .post('/api/agents/verify-pin')
      .send({ agentId: 'bad-id', pin: '1234' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when pin is missing', async () => {
    const res = await request(app)
      .post('/api/agents/verify-pin')
      .send({ agentId: '550e8400-e29b-41d4-a716-446655440000' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when pin is too short', async () => {
    const res = await request(app)
      .post('/api/agents/verify-pin')
      .send({ agentId: '550e8400-e29b-41d4-a716-446655440000', pin: '12' });
    expect(res.status).toBe(400);
  });

  it('returns 500 on service error', async () => {
    mockVerifyPin.mockRejectedValueOnce(new Error('bcrypt error'));
    const res = await request(app)
      .post('/api/agents/verify-pin')
      .send({ agentId: '550e8400-e29b-41d4-a716-446655440000', pin: '1234' });
    expect(res.status).toBe(500);
  });
});