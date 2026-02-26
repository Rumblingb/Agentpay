/**
 * Unit tests for UUID validation in merchant payment routes.
 * Verifies that invalid/missing transaction IDs return 400 before any DB call.
 */

// ---- Mock db, auth, and related services before any imports ----
jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  pool: { on: jest.fn() },
  closePool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/transactions', () => ({
  getTransaction: jest.fn(),
  getMerchantTransactions: jest.fn(),
  getMerchantStats: jest.fn(),
  verifyAndUpdatePayment: jest.fn(),
  createPaymentRequest: jest.fn(),
  default: {
    getTransaction: jest.fn(),
    getMerchantTransactions: jest.fn(),
    getMerchantStats: jest.fn(),
    verifyAndUpdatePayment: jest.fn(),
    createPaymentRequest: jest.fn(),
  },
}));

jest.mock('../../src/services/webhooks', () => ({
  scheduleWebhook: jest.fn(),
  default: { scheduleWebhook: jest.fn() },
}));

jest.mock('../../src/services/webhookEmitter', () => ({
  emitPaymentVerified: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/audit', () => ({
  logVerifyAttempt: jest.fn().mockResolvedValue(undefined),
  default: { logVerifyAttempt: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../../src/services/billingService', () => ({
  billMerchant: jest.fn().mockResolvedValue({}),
  getMerchantInvoices: jest.fn().mockResolvedValue([]),
  PLATFORM_FEE_PERCENT: 0.02,
}));

jest.mock('../../src/services/certificateService', () => ({
  signCertificate: jest.fn().mockReturnValue('mock-certificate'),
}));

jest.mock('../../src/services/stripeService', () => ({
  createConnectOnboardingLink: jest.fn(),
  createFiatIntent: jest.fn(),
  constructStripeEvent: jest.fn(),
  getIntentByStripeReference: jest.fn(),
  markIntentVerified: jest.fn(),
}));

// Mock authenticateApiKey to always inject a fake merchant
jest.mock('../../src/middleware/auth', () => ({
  authenticateApiKey: (req: any, _res: any, next: any) => {
    req.merchant = {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      name: 'Test Merchant',
      email: 'merchant@example.com',
      walletAddress: '5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqD',
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
      const { getTransaction } = require('../../src/services/transactions');
      (getTransaction as jest.Mock).mockResolvedValue(null);

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
      const { getTransaction } = require('../../src/services/transactions');
      (getTransaction as jest.Mock).mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/merchants/payments/${VALID_UUID}/verify`)
        .set('Authorization', 'Bearer fake-api-key')
        .send({ transactionHash: 'someHash' });

      // Should proceed to DB lookup and return 404 (not found), not 400 (bad UUID)
      expect(res.status).toBe(404);
    });
  });
});
