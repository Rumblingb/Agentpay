/**
 * Tests for the Stripe webhook handler (POST /webhooks/stripe).
 *
 * We mock stripeService so no real Stripe calls are made, and we mock
 * webhooksService to verify that the payment_verified webhook is fired.
 */

import request from 'supertest';
import crypto from 'crypto';
import app from '../src/server';

// ── Module mocks ────────────────────────────────────────────────────────────

jest.mock('../src/services/stripeService', () => ({
  constructStripeEvent: jest.fn(),
  getIntentByStripeReference: jest.fn(),
  markIntentVerified: jest.fn(),
  createConnectOnboardingLink: jest.fn(),
  createFiatIntent: jest.fn(),
}));

jest.mock('../src/services/webhooks', () => ({
  scheduleWebhook: jest.fn().mockResolvedValue(undefined),
  signPayload: jest.fn().mockReturnValue('sha256=mocksig'),
}));

jest.mock('../src/db/index', () => ({
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import * as stripeService from '../src/services/stripeService';
import * as webhooksService from '../src/services/webhooks';
import * as db from '../src/db/index';

const mockConstructStripeEvent = stripeService.constructStripeEvent as jest.Mock;
const mockGetIntentByRef = stripeService.getIntentByStripeReference as jest.Mock;
const mockMarkIntentVerified = stripeService.markIntentVerified as jest.Mock;
const mockScheduleWebhook = webhooksService.scheduleWebhook as jest.Mock;
const mockQuery = db.query as jest.Mock;

/** Minimal fake Stripe event factory */
function fakeCheckoutEvent(sessionId: string, merchantId: string) {
  return {
    id: 'evt_test_123',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        metadata: { merchantId },
      },
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /webhooks/stripe', () => {
  const DUMMY_SIG = 'stripe-sig-header';
  const RAW_BODY = Buffer.from('{}');

  beforeEach(() => {
    jest.clearAllMocks();
    // Default DB response for merchant webhook_url lookup
    mockQuery.mockResolvedValue({ rows: [{ webhookUrl: 'https://merchant.example.com/hook' }] });
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(RAW_BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stripe-signature/i);
  });

  it('returns 400 when signature verification fails', async () => {
    mockConstructStripeEvent.mockImplementation(() => {
      throw new Error('Webhook signature verification failed');
    });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', DUMMY_SIG)
      .send(RAW_BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
  });

  it('returns 200 and acknowledges unknown event types gracefully', async () => {
    mockConstructStripeEvent.mockReturnValue({
      id: 'evt_unknown',
      type: 'payment_intent.created',
      data: { object: {} },
    });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', DUMMY_SIG)
      .send(RAW_BODY);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(mockMarkIntentVerified).not.toHaveBeenCalled();
  });

  it('handles checkout.session.completed: marks intent verified and fires webhook', async () => {
    const sessionId = 'cs_test_abc123';
    const merchantId = 'merchant-uuid-001';
    const transactionId = 'txn-uuid-001';

    mockConstructStripeEvent.mockReturnValue(fakeCheckoutEvent(sessionId, merchantId));
    mockGetIntentByRef.mockResolvedValue({ id: transactionId, merchantId });
    mockMarkIntentVerified.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', DUMMY_SIG)
      .send(RAW_BODY);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    // Give the async post-response work a tick to run
    await new Promise((r) => setImmediate(r));

    expect(mockGetIntentByRef).toHaveBeenCalledWith(sessionId);
    expect(mockMarkIntentVerified).toHaveBeenCalledWith(transactionId, sessionId);
    expect(mockScheduleWebhook).toHaveBeenCalledWith(
      'https://merchant.example.com/hook',
      expect.objectContaining({
        event: 'payment.verified',
        transactionId,
        merchantId,
        verified: true,
      }),
      merchantId,
      transactionId
    );
  });

  it('handles checkout.session.completed when no linked transaction exists', async () => {
    const sessionId = 'cs_test_no_link';
    const merchantId = 'merchant-uuid-002';

    mockConstructStripeEvent.mockReturnValue(fakeCheckoutEvent(sessionId, merchantId));
    mockGetIntentByRef.mockResolvedValue(null);

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', DUMMY_SIG)
      .send(RAW_BODY);

    expect(res.status).toBe(200);

    await new Promise((r) => setImmediate(r));

    expect(mockMarkIntentVerified).not.toHaveBeenCalled();
    expect(mockScheduleWebhook).not.toHaveBeenCalled();
  });

  it('does not fire webhook when merchant has no webhookUrl configured', async () => {
    const sessionId = 'cs_test_no_hook';
    const merchantId = 'merchant-uuid-003';
    const transactionId = 'txn-uuid-003';

    mockConstructStripeEvent.mockReturnValue(fakeCheckoutEvent(sessionId, merchantId));
    mockGetIntentByRef.mockResolvedValue({ id: transactionId, merchantId });
    mockMarkIntentVerified.mockResolvedValue(undefined);
    // Merchant has no webhook URL
    mockQuery.mockResolvedValue({ rows: [{ webhookUrl: null }] });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', DUMMY_SIG)
      .send(RAW_BODY);

    expect(res.status).toBe(200);

    await new Promise((r) => setImmediate(r));

    expect(mockMarkIntentVerified).toHaveBeenCalledWith(transactionId, sessionId);
    expect(mockScheduleWebhook).not.toHaveBeenCalled();
  });
});
