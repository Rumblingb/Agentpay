/**
 * Unit tests for POST /api/merchants/stripe/connect
 * Verifies that the endpoint calls stripeService.createConnectOnboardingLink
 * and returns the onboarding URL to the merchant.
 */

// ---- Mock db, auth, and stripeService before any imports ----
jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  pool: { on: jest.fn() },
  closePool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/stripeService', () => ({
  createConnectOnboardingLink: jest.fn(),
  createFiatIntent: jest.fn(),
  constructStripeEvent: jest.fn(),
  getIntentByStripeReference: jest.fn(),
  markIntentVerified: jest.fn(),
  default: {
    createConnectOnboardingLink: jest.fn(),
    createFiatIntent: jest.fn(),
    constructStripeEvent: jest.fn(),
    getIntentByStripeReference: jest.fn(),
    markIntentVerified: jest.fn(),
  },
}));

// Mock authenticateApiKey to always inject a fake merchant
jest.mock('../../src/middleware/auth', () => ({
  authenticateApiKey: (req: any, _res: any, next: any) => {
    req.merchant = {
      id: 'merchant-uuid-001',
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
import * as stripeService from '../../src/services/stripeService';

const mockCreateOnboarding = stripeService.createConnectOnboardingLink as jest.Mock;

describe('POST /api/merchants/stripe/connect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with onboarding URL on success', async () => {
    mockCreateOnboarding.mockResolvedValue({
      url: 'https://connect.stripe.com/setup/s/abc123',
      accountId: 'acct_1234567890',
    });

    const res = await request(app)
      .post('/api/merchants/stripe/connect')
      .set('Authorization', 'Bearer fake-api-key')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.onboardingUrl).toBe('https://connect.stripe.com/setup/s/abc123');
    expect(res.body.stripeAccountId).toBe('acct_1234567890');
    expect(mockCreateOnboarding).toHaveBeenCalledWith(
      'merchant-uuid-001',
      'merchant@example.com',
      expect.stringContaining('/api/stripe/onboard/return'),
      expect.stringContaining('/api/stripe/onboard/refresh'),
    );
  });

  it('returns 500 when Stripe service throws', async () => {
    mockCreateOnboarding.mockRejectedValue(new Error('Stripe API error'));

    const res = await request(app)
      .post('/api/merchants/stripe/connect')
      .set('Authorization', 'Bearer fake-api-key')
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/stripe api error/i);
  });

  it('uses custom returnUrl and refreshUrl when provided', async () => {
    mockCreateOnboarding.mockResolvedValue({
      url: 'https://connect.stripe.com/setup/s/custom',
      accountId: 'acct_custom',
    });

    await request(app)
      .post('/api/merchants/stripe/connect')
      .set('Authorization', 'Bearer fake-api-key')
      .send({
        returnUrl: 'https://myapp.com/stripe/return',
        refreshUrl: 'https://myapp.com/stripe/refresh',
      });

    expect(mockCreateOnboarding).toHaveBeenCalledWith(
      'merchant-uuid-001',
      'merchant@example.com',
      'https://myapp.com/stripe/return',
      'https://myapp.com/stripe/refresh',
    );
  });
});
