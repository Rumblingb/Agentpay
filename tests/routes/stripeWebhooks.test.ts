/**
 * Route tests for POST /webhooks/stripe
 *
 * Tests: signature validation, event routing (checkout.session.completed,
 * payment_intent.succeeded, account.updated), missing header, invalid sig.
 * Phase 10: settlement event ingestion + resolution engine integration.
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

// Phase 10 mocks
const mockIngestStripeProof = jest.fn().mockReturnValue('mock-event-id');
const mockRunEngine = jest.fn();

jest.mock('../../src/settlement/settlementEventIngestion', () => ({
  ingestStripeProof: mockIngestStripeProof,
  normalizeStripeObservation: jest.requireActual(
    '../../src/settlement/settlementEventIngestion',
  ).normalizeStripeObservation,
  normalizeSolanaObservation: jest.fn(),
  ingestSolanaProof: jest.fn(),
}));

jest.mock('../../src/settlement/intentResolutionEngine', () => ({
  runResolutionEngine: mockRunEngine,
}));

import request from 'supertest';
import app from '../../src/server';
import * as db from '../../src/db/index';

const mockQuery = db.query as jest.Mock;

describe('POST /webhooks/stripe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no payment_id lookup result
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

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
      data: { object: { id: 'cs_test_abc', amount_total: 1000, currency: 'usd', customer: null, metadata: {} } },
    });
    mockGetIntent.mockResolvedValueOnce({
      id: 'tx-uuid',
      merchantId: 'merchant-uuid',
    });
    mockMarkVerified.mockResolvedValueOnce(undefined);
    // webhookUrl query
    mockQuery
      .mockResolvedValueOnce({ rows: [{ webhookUrl: 'https://example.com/webhook' }] })
      // payment_id lookup
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'valid-sig')
      .send(JSON.stringify({ type: 'checkout.session.completed' }));

    expect(res.status).toBe(200);
  });

  it('handles checkout.session.completed with no matching intent gracefully', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_no_match', amount_total: null, currency: null, customer: null, metadata: {} } },
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
      data: { object: { id: 'pi_test_succeeded', amount: 1000, currency: 'usd', customer: null, metadata: {} } },
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
    // Only the initial mockQuery.mockResolvedValue({ rows: [] }) from beforeEach;
    // no additional DB call expected for details_submitted=false
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

  // ── Phase 10: settlement event ingestion ────────────────────────────────

  describe('Phase 10: settlement event ingestion', () => {
    it('calls ingestStripeProof() for checkout.session.completed', async () => {
      mockConstructEvent.mockReturnValueOnce({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_p10_001',
            amount_total: 1500,
            currency: 'usd',
            customer: 'cus_stripe_customer',
            metadata: {},
          },
        },
      });
      mockGetIntent.mockResolvedValueOnce({ id: 'tx-uuid-p10', merchantId: 'merchant-p10' });
      mockMarkVerified.mockResolvedValueOnce(undefined);
      // webhookUrl, payment_id
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/webhooks/stripe')
        .set('stripe-signature', 'valid-sig')
        .send('{}');

      // Allow async work to flush
      await new Promise((r) => setTimeout(r, 20));

      expect(mockIngestStripeProof).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeEventType: 'checkout.session.completed',
          externalId: 'cs_p10_001',
          status: 'succeeded',
          amountTotal: 1500,
          currency: 'usd',
          customerId: 'cus_stripe_customer',
        }),
        expect.any(Object),
      );
    });

    it('calls ingestStripeProof() for payment_intent.succeeded', async () => {
      mockConstructEvent.mockReturnValueOnce({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_p10_002',
            amount: 2000,
            currency: 'usd',
            customer: 'cus_abc',
            metadata: {},
          },
        },
      });
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await request(app)
        .post('/webhooks/stripe')
        .set('stripe-signature', 'valid-sig')
        .send('{}');

      await new Promise((r) => setTimeout(r, 20));

      expect(mockIngestStripeProof).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeEventType: 'payment_intent.succeeded',
          externalId: 'pi_p10_002',
          status: 'succeeded',
          amountTotal: 2000,
        }),
      );
    });

    it('does NOT call ingestStripeProof() for account.updated', async () => {
      mockConstructEvent.mockReturnValueOnce({
        type: 'account.updated',
        data: { object: { id: 'acct_p10', details_submitted: true } },
      });
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await request(app)
        .post('/webhooks/stripe')
        .set('stripe-signature', 'valid-sig')
        .send('{}');

      await new Promise((r) => setTimeout(r, 20));

      expect(mockIngestStripeProof).not.toHaveBeenCalled();
    });

    it('calls runResolutionEngine() with paymentIntentId when payment_id lookup succeeds', async () => {
      mockConstructEvent.mockReturnValueOnce({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_p10_engine',
            amount_total: 1000,
            currency: 'usd',
            customer: null,
            metadata: {},
          },
        },
      });
      mockGetIntent.mockResolvedValueOnce({ id: 'tx-uuid-engine', merchantId: 'merchant-engine' });
      mockMarkVerified.mockResolvedValueOnce(undefined);
      // webhookUrl query → no webhook
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        // payment_id lookup → found
        .mockResolvedValueOnce({ rows: [{ paymentIntentId: 'pi-uuid-engine' }] })
        // getIntentAmount → found
        .mockResolvedValueOnce({ rows: [{ amount: '10.00' }] });

      mockRunEngine.mockResolvedValue({
        resolution: { id: 'res-p10' },
        evaluation: {
          decision: 'matched',
          reasonCode: 'identity_confirmed',
          resolutionStatus: 'confirmed',
          confidenceScore: 0.95,
        },
        wasAlreadyResolved: false,
      });

      await request(app)
        .post('/webhooks/stripe')
        .set('stripe-signature', 'valid-sig')
        .send('{}');

      // setImmediate queues the engine call — flush microtask queue
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 50));

      expect(mockRunEngine).toHaveBeenCalledWith(
        expect.objectContaining({
          intentId: 'pi-uuid-engine',
          resolvedBy: 'stripe_webhook',
          merchantWallet: null,
          proof: expect.objectContaining({
            protocol: 'stripe',
            proofType: 'stripe_session_id',
            externalRef: 'cs_p10_engine',
            observedStatus: 'confirmed',
          }),
        }),
      );
    });

    it('does NOT call runResolutionEngine() when payment_id lookup returns nothing', async () => {
      mockConstructEvent.mockReturnValueOnce({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_p10_no_pi',
            amount_total: 500,
            currency: 'usd',
            customer: null,
            metadata: {},
          },
        },
      });
      mockGetIntent.mockResolvedValueOnce({ id: 'tx-uuid-no-pi', merchantId: 'merchant-no-pi' });
      mockMarkVerified.mockResolvedValueOnce(undefined);
      // webhookUrl → none; payment_id → not found
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/webhooks/stripe')
        .set('stripe-signature', 'valid-sig')
        .send('{}');

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 50));

      expect(mockRunEngine).not.toHaveBeenCalled();
    });

    it('continues without error when runResolutionEngine() throws', async () => {
      mockConstructEvent.mockReturnValueOnce({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_p10_engine_err',
            amount_total: 500,
            currency: 'usd',
            customer: null,
            metadata: {},
          },
        },
      });
      mockGetIntent.mockResolvedValueOnce({ id: 'tx-engine-err', merchantId: 'merchant-err' });
      mockMarkVerified.mockResolvedValueOnce(undefined);
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ paymentIntentId: 'pi-err' }] })
        .mockResolvedValueOnce({ rows: [{ amount: '5.00' }] });

      mockRunEngine.mockRejectedValue(new Error('engine exploded'));

      // Should not throw
      const res = await request(app)
        .post('/webhooks/stripe')
        .set('stripe-signature', 'valid-sig')
        .send('{}');

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 50));

      expect(res.status).toBe(200);
    });
  });
});