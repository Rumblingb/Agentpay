/**
 * Unit tests for UUID validation in merchant payment routes.
 * Ensures invalid UUIDs are rejected before reaching the database.
 */

// ---- Mock db and auth before any imports ----
jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  pool: { on: jest.fn() },
  closePool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/middleware/auth', () => ({
  authenticateApiKey: (req: any, _res: any, next: any) => {
    req.merchant = {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      email: 'merchant@example.com',
      webhookUrl: null,
    };
    next();
  },
}));

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    merchant: { findUniqueOrThrow: jest.fn(), findUnique: jest.fn() },
    paymentIntent: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    verificationCertificate: { create: jest.fn() },
  },
}));

import request from 'supertest';
import app from '../../src/server';

const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';

describe('UUID validation in merchant payment routes', () => {
  describe('GET /api/merchants/payments/:transactionId', () => {
    it('returns 400 for a non-UUID transactionId', async () => {
      const res = await request(app)
        .get('/api/merchants/payments/not-a-uuid')
        .set('Authorization', 'Bearer fake-api-key');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid transaction id/i);
    });

    it('returns 400 for the string "undefined" as transactionId', async () => {
      const res = await request(app)
        .get('/api/merchants/payments/undefined')
        .set('Authorization', 'Bearer fake-api-key');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid transaction id/i);
    });

    it('proceeds past UUID validation for a valid UUID transactionId', async () => {
      const { query } = require('../../src/db/index');
      (query as jest.Mock).mockResolvedValue({ rows: [] });

      const res = await request(app)
        .get(`/api/merchants/payments/${VALID_UUID}`)
        .set('Authorization', 'Bearer fake-api-key');

      // Should proceed to DB lookup and return 404 (not found), not 400
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/merchants/payments/:transactionId/verify', () => {
    it('returns 400 for a non-UUID transactionId', async () => {
      const res = await request(app)
        .post('/api/merchants/payments/not-a-uuid/verify')
        .set('Authorization', 'Bearer fake-api-key')
        .send({ transactionHash: 'someHash' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid transaction id/i);
    });

    it('returns 400 for the string "undefined" as transactionId', async () => {
      const res = await request(app)
        .post('/api/merchants/payments/undefined/verify')
        .set('Authorization', 'Bearer fake-api-key')
        .send({ transactionHash: 'someHash' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid transaction id/i);
    });

    it('proceeds past UUID validation for a valid UUID transactionId', async () => {
      const { query } = require('../../src/db/index');
      (query as jest.Mock).mockResolvedValue({ rows: [] });

      const res = await request(app)
        .post(`/api/merchants/payments/${VALID_UUID}/verify`)
        .set('Authorization', 'Bearer fake-api-key')
        .send({ transactionHash: 'someHash' });

      // Should proceed to DB lookup and return 404 (not found), not 400 (bad UUID)
      expect(res.status).toBe(404);
    });
  });
});
