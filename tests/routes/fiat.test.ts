/**
 * Route tests for /api/fiat — onramp, offramp, and issuing endpoints.
 * Stripe is mocked. Auth is mocked.
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

const mockCheckoutCreate = jest.fn();
const mockPayoutsCreate = jest.fn();
const mockIssuingCardsCreate = jest.fn();

jest.mock('../../src/services/stripeService', () => ({
  getStripe: jest.fn(() => ({
    checkout: { sessions: { create: mockCheckoutCreate } },
    payouts: { create: mockPayoutsCreate },
    issuing: { cards: { create: mockIssuingCardsCreate } },
  })),
  constructStripeEvent: jest.fn(),
  getIntentByStripeReference: jest.fn(),
  markIntentVerified: jest.fn(),
  createConnectOnboardingLink: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  authenticateApiKey: (_req: any, _res: any, next: any) => {
    _req.merchant = { id: 'merchant-001', name: 'Test', email: 't@t.com', walletAddress: 'wa' };
    next();
  },
}));

import request from 'supertest';
import app from '../../src/server';

describe('POST /api/fiat/onramp', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 201 with sessionId on success', async () => {
    mockCheckoutCreate.mockResolvedValueOnce({
      id: 'cs_test_session_abc',
      url: 'https://checkout.stripe.com/pay/cs_test_abc',
    });

    const res = await request(app)
      .post('/api/fiat/onramp')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ amountUsd: 50 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sessionId).toBe('cs_test_session_abc');
    expect(res.body.data.sessionUrl).toBeDefined();
  });

  it('returns 400 when amountUsd is missing', async () => {
    const res = await request(app)
      .post('/api/fiat/onramp')
      .set('Authorization', 'sk_test_sim_12345')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when amountUsd is zero', async () => {
    const res = await request(app)
      .post('/api/fiat/onramp')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ amountUsd: 0 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when amountUsd is negative', async () => {
    const res = await request(app)
      .post('/api/fiat/onramp')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ amountUsd: -10 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when amountUsd is a string', async () => {
    const res = await request(app)
      .post('/api/fiat/onramp')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ amountUsd: 'fifty' });
    expect(res.status).toBe(400);
  });

  it('returns 500 on Stripe error', async () => {
    mockCheckoutCreate.mockRejectedValueOnce(new Error('Stripe unavailable'));
    const res = await request(app)
      .post('/api/fiat/onramp')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ amountUsd: 100 });
    expect(res.status).toBe(500);
  });

  it('converts amountUsd to cents correctly (avoids floating point)', async () => {
    mockCheckoutCreate.mockResolvedValueOnce({ id: 'cs_abc', url: 'https://example.com' });
    await request(app)
      .post('/api/fiat/onramp')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ amountUsd: 9.99 });
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: expect.arrayContaining([
          expect.objectContaining({
            price_data: expect.objectContaining({ unit_amount: 999 }),
          }),
        ]),
      })
    );
  });
});

describe('POST /api/fiat/offramp', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 201 with payoutId on success', async () => {
    mockPayoutsCreate.mockResolvedValueOnce({ id: 'po_test_abc', status: 'pending' });
    const res = await request(app)
      .post('/api/fiat/offramp')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ connectedAccountId: 'acct_abc', amountUsd: 25 });

    expect(res.status).toBe(201);
    expect(res.body.data.payoutId).toBe('po_test_abc');
    expect(res.body.data.status).toBe('pending');
  });

  it('returns 400 when connectedAccountId is missing', async () => {
    const res = await request(app)
      .post('/api/fiat/offramp')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ amountUsd: 25 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when amountUsd is missing', async () => {
    const res = await request(app)
      .post('/api/fiat/offramp')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ connectedAccountId: 'acct_abc' });
    expect(res.status).toBe(400);
  });

  it('returns 500 on Stripe error', async () => {
    mockPayoutsCreate.mockRejectedValueOnce(new Error('Payout failed'));
    const res = await request(app)
      .post('/api/fiat/offramp')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ connectedAccountId: 'acct_abc', amountUsd: 100 });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/fiat/issuing/create-card', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 201 with cardId on success', async () => {
    mockIssuingCardsCreate.mockResolvedValueOnce({
      id: 'ic_test_card',
      last4: '4242',
      status: 'active',
    });

    const res = await request(app)
      .post('/api/fiat/issuing/create-card')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ connectedAccountId: 'acct_abc', cardholderId: 'ich_test_001' });

    expect(res.status).toBe(201);
    expect(res.body.data.cardId).toBe('ic_test_card');
    expect(res.body.data.last4).toBe('4242');
  });

  it('returns 400 when connectedAccountId is missing', async () => {
    const res = await request(app)
      .post('/api/fiat/issuing/create-card')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ cardholderId: 'ich_test' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when cardholderId is missing', async () => {
    const res = await request(app)
      .post('/api/fiat/issuing/create-card')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ connectedAccountId: 'acct_abc' });
    expect(res.status).toBe(400);
  });

  it('applies spendingLimit when provided', async () => {
    mockIssuingCardsCreate.mockResolvedValueOnce({ id: 'ic_test', last4: '1234', status: 'active' });
    await request(app)
      .post('/api/fiat/issuing/create-card')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ connectedAccountId: 'acct_abc', cardholderId: 'ich_001', spendingLimit: 500 });

    expect(mockIssuingCardsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        spending_controls: expect.objectContaining({
          spending_limits: expect.arrayContaining([
            expect.objectContaining({ amount: 50000 }), // $500 * 100
          ]),
        }),
      }),
      expect.any(Object)
    );
  });

  it('returns 500 on Stripe error', async () => {
    mockIssuingCardsCreate.mockRejectedValueOnce(new Error('Stripe issuing error'));
    const res = await request(app)
      .post('/api/fiat/issuing/create-card')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ connectedAccountId: 'acct_abc', cardholderId: 'ich_001' });
    expect(res.status).toBe(500);
  });
});
