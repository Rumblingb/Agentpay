/**
 * Route tests for /api/kya — Know Your Agent identity routes.
 * Uses in-memory store (no DB mock needed).
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

import request from 'supertest';
import app from '../../src/server';
import { _resetStore } from '../../src/identity/kya-gateway';

describe('/api/kya', () => {
  beforeEach(() => {
    _resetStore(); // reset the in-memory KYA store between tests
  });

  // ---------- POST /register ----------
  describe('POST /api/kya/register', () => {
    it('returns 201 with identity on valid registration', async () => {
      const res = await request(app).post('/api/kya/register').send({
        agentId: 'agent-kya-001',
        ownerEmail: 'owner@example.com',
      });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.identity.agentId).toBe('agent-kya-001');
      expect(res.body.identity.ownerEmail).toBe('owner@example.com');
    });

    it('auto-verifies when both stripeAccount and platformToken provided', async () => {
      const res = await request(app).post('/api/kya/register').send({
        agentId: 'agent-kya-verified',
        ownerEmail: 'owner@example.com',
        stripeAccount: 'acct_abc123',
        platformToken: 'token-xyz',
      });
      expect(res.status).toBe(201);
      expect(res.body.identity.verified).toBe(true);
      expect(res.body.identity.kycStatus).toBe('verified');
    });

    it('status is pending when neither stripe nor platform token provided', async () => {
      const res = await request(app).post('/api/kya/register').send({
        agentId: 'agent-kya-pending',
        ownerEmail: 'owner@example.com',
      });
      expect(res.status).toBe(201);
      expect(res.body.identity.kycStatus).toBe('pending');
      expect(res.body.identity.verified).toBe(false);
    });

    it('returns 400 for invalid email', async () => {
      const res = await request(app).post('/api/kya/register').send({
        agentId: 'agent-kya-bad-email',
        ownerEmail: 'not-an-email',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when agentId is missing', async () => {
      const res = await request(app).post('/api/kya/register').send({
        ownerEmail: 'owner@example.com',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when ownerEmail is missing', async () => {
      const res = await request(app).post('/api/kya/register').send({
        agentId: 'agent-kya-no-email',
      });
      expect(res.status).toBe(400);
    });

    it('returns 409 when agent is already registered', async () => {
      // First registration
      await request(app).post('/api/kya/register').send({
        agentId: 'agent-kya-dup',
        ownerEmail: 'owner@example.com',
      });
      // Duplicate
      const res = await request(app).post('/api/kya/register').send({
        agentId: 'agent-kya-dup',
        ownerEmail: 'other@example.com',
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already registered');
    });

    it('riskScore decreases with more verification signals', async () => {
      const noVerification = await request(app).post('/api/kya/register').send({
        agentId: 'agent-no-verify',
        ownerEmail: 'a@example.com',
      });
      _resetStore();
      const fullVerification = await request(app).post('/api/kya/register').send({
        agentId: 'agent-full-verify',
        ownerEmail: 'b@example.com',
        stripeAccount: 'acct_123',
        platformToken: 'tok_abc',
        worldIdHash: 'wid_hash',
      });
      expect(fullVerification.body.identity.riskScore).toBeLessThan(
        noVerification.body.identity.riskScore
      );
    });
  });

  // ---------- GET /:agentId ----------
  describe('GET /api/kya/:agentId', () => {
    it('returns 200 with identity for a registered agent', async () => {
      await request(app).post('/api/kya/register').send({
        agentId: 'agent-lookup',
        ownerEmail: 'owner@example.com',
      });
      const res = await request(app).get('/api/kya/agent-lookup');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.identity.agentId).toBe('agent-lookup');
    });

    it('returns 404 for unknown agentId', async () => {
      const res = await request(app).get('/api/kya/nonexistent-agent');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });
});