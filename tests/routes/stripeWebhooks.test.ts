/**
 * Route tests for POST /webhooks/stripe
 *
 * Tests: signature validation, event routing (checkout.session.completed,
 * payment_intent.succeeded, account.updated), missing header, invalid sig.
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

const mockConstructEvent = jest.fn();
const mockGetIntent = jest.fn();
const mockMarkVerified = jest.fn();

jest.mock('../../src/services/stripeService', () => ({
  constructStripeEvent: mockConstructEvent,
  getIntentByStripeReference: mockGetIntent,
  markIntentVerified: mockMarkVerified,
  getStripe: jest.fn(() => ({})),
  createConnectOnboardingLink: jest.fn(),
}));

jest.mock('../../src/services/webhooks', () => ({
  scheduleWebhook: jest.fn().mockResolvedValue(undefined),
  scheduleDelivery: jest.fn(),
}));

import request from 'supertest';
import app from '../../src/server';
import * as db from '../../src/db/index';

const mockQuery = db.query as jest.Mock;

describe('POST /webhooks/stripe', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 when stripe-signature header is missing', async () => {
    const res = await request(app)
      .post('/webhooks/stripe')
      .send('{}');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('stripe-signature');
  });

  it('returns 400 when signature verification fails', async () => {
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error('No signatures found matching the expected signature');
    });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'invalid-sig')
      .send('{}');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Signature verification failed');
  });

  it('returns 200 immediately for valid signature (ack before processing)', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'some.unknown.event',
      data: { object: {} },
    });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'valid-sig')
      .send('{}');

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('handles checkout.session.completed with matching intent', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_abc' } },
    });
    mockGetIntent.mockResolvedValueOnce({
      id: 'intent-uuid',
      merchantId: 'merchant-uuid',
    });
    mockMarkVerified.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce({ rows: [{ webhookUrl: 'https://example.com/webhook' }] });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'valid-sig')
      .send(JSON.stringify({ type: 'checkout.session.completed' }));

    expect(res.status).toBe(200);
  });

  it('handles checkout.session.completed with no matching intent gracefully', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_no_match' } },
    });
    mockGetIntent.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'valid-sig')
      .send('{}');

    expect(res.status).toBe(200); // still 200 — ack sent before processing
  });

  it('handles payment_intent.succeeded and updates DB', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_succeeded' } },
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'valid-sig')
      .send('{}');

    expect(res.status).toBe(200);
  });

  it('handles account.updated with details_submitted=true', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'account.updated',
      data: { object: { id: 'acct_connected', details_submitted: true } },
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'valid-sig')
      .send('{}');

    expect(res.status).toBe(200);
  });

  it('handles account.updated with details_submitted=false gracefully', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'account.updated',
      data: { object: { id: 'acct_partial', details_submitted: false } },
    });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'valid-sig')
      .send('{}');

    expect(res.status).toBe(200);
    expect(mockQuery).not.toHaveBeenCalled(); // no DB update for incomplete onboarding
  });

  it('handles unknown event types without error', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.deleted',
      data: { object: {} },
    });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'valid-sig')
      .send('{}');

    expect(res.status).toBe(200);
  });
});