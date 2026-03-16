/**
 * Route tests for GET /api/verify/:txHash
 *
 * Tests: settlement-aware status (unseen/observed/matched/confirmed/unmatched),
 * legacy transaction fallback, HMAC signature, invalid hash format, missing secret.
 *
 * Query call order for each request:
 *   1. querySettlementEvent  (settlement_events WHERE external_ref = $1)
 *   2a. If event found with intentId:
 *       queryIntentResolution + queryPaymentIntent  (parallel)
 *   2b. If no event: queryLegacyTransaction  (transactions WHERE transaction_hash = $1)
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
import * as db from '../../src/db/index';

let app: any;
let mockQuery: jest.Mock;

const VALID_SOLANA_HASH = '5W2v3RrRTXuCCZB8FrdQAuREf9JHMETVvHWw4rVSEGbgM1SjS5qw8ZAjS9Nqz7R';
const VALID_EVM_HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

// Helper: mock the "no settlement event + legacy transaction" path
function mockLegacyTx(txRow: object | null) {
  mockQuery
    .mockResolvedValueOnce({ rows: [] }) // settlement_events → not found
    .mockResolvedValueOnce({ rows: txRow ? [txRow] : [] }); // transactions fallback
}

// Helper: mock the "settlement event found + resolution + intent" path
function mockSettlementChain(
  eventRow: object,
  resolutionRow: object | null,
  intentRow: object | null,
) {
  mockQuery
    .mockResolvedValueOnce({ rows: [eventRow] })           // settlement_events
    .mockResolvedValueOnce({ rows: resolutionRow ? [resolutionRow] : [] }) // intent_resolutions
    .mockResolvedValueOnce({ rows: intentRow ? [intentRow] : [] });       // payment_intents
}

describe('GET /api/verify/:txHash', () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock('uuid', () => ({ validate: () => true, v4: () => '00000000-0000-0000-0000-000000000000' }));
    jest.doMock('../../src/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));
    jest.doMock('../../src/security/payment-verification', () => ({
      verifyPaymentRecipient: async () => ({ valid: false }),
      checkConfirmationDepth: async () => ({ confirmed: false, depth: 0, required: 2 }),
      isValidSolanaAddress: (_: string) => true,
    }));
    jest.doMock('../../src/db/index', () => ({
      query: jest.fn(),
      pool: { on: jest.fn() },
      closePool: jest.fn().mockResolvedValue(undefined),
    }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const express = require('express');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const verifyRouter = require('../../src/routes/verify').default;
    const expressApp = express();
    expressApp.use('/api/verify', verifyRouter);
    app = expressApp;
    mockQuery = require('../../src/db/index').query as jest.Mock;
  });

  beforeEach(() => jest.clearAllMocks());

  // ── Legacy transaction fallback ──────────────────────────────────────────

  it('returns status:confirmed + verified:true for a confirmed legacy transaction', async () => {
    mockLegacyTx({
      id: 'intent-uuid',
      merchantId: 'merchant-uuid',
      agentId: 'agent-uuid',
      status: 'confirmed',
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.status).toBe('confirmed');
    expect(res.body.intentId).toBe('intent-uuid');
    expect(res.body.merchantId).toBe('merchant-uuid');
    expect(res.body.agentId).toBe('agent-uuid');
  });

  it('returns status:observed + verified:false for a pending legacy transaction', async () => {
    mockLegacyTx({
      id: 'intent-uuid',
      merchantId: 'merchant-uuid',
      agentId: null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.status).toBe('observed');
  });

  it('returns status:unseen + verified:false when nothing is found', async () => {
    mockLegacyTx(null);

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.status).toBe('unseen');
    expect(res.body.intentId).toBeNull();
    expect(res.body.reasonCode).toBeNull();
  });

  // ── Settlement chain: resolution present ─────────────────────────────────

  it('returns status:confirmed when resolution_status=confirmed', async () => {
    mockSettlementChain(
      { eventId: 'ev-001', intentId: 'pi-001', eventType: 'on_chain_confirmed', protocol: 'solana', createdAt: new Date().toISOString() },
      { resolutionId: 'res-001', resolutionStatus: 'confirmed', decisionCode: 'matched', reasonCode: 'exact_amount', resolvedAt: new Date().toISOString() },
      { intentId: 'pi-001', merchantId: 'merch-001', agentId: 'agent-001', status: 'completed', createdAt: new Date().toISOString() },
    );

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.status).toBe('confirmed');
    expect(res.body.intentId).toBe('pi-001');
    expect(res.body.merchantId).toBe('merch-001');
    expect(res.body.agentId).toBe('agent-001');
  });

  it('returns status:unmatched + reasonCode when resolution_status=failed', async () => {
    mockSettlementChain(
      { eventId: 'ev-002', intentId: 'pi-002', eventType: 'on_chain_confirmed', protocol: 'solana', createdAt: new Date().toISOString() },
      { resolutionId: 'res-002', resolutionStatus: 'failed', decisionCode: 'unmatched', reasonCode: 'recipient_mismatch', resolvedAt: new Date().toISOString() },
      { intentId: 'pi-002', merchantId: 'merch-002', agentId: null, status: 'failed', createdAt: new Date().toISOString() },
    );

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.status).toBe('unmatched');
    expect(res.body.reasonCode).toBe('recipient_mismatch');
  });

  // ── Settlement chain: event present, resolution not yet run ──────────────

  it('returns status:observed when settlement event is hash_submitted (no resolution)', async () => {
    mockSettlementChain(
      { eventId: 'ev-003', intentId: 'pi-003', eventType: 'hash_submitted', protocol: 'solana', createdAt: new Date().toISOString() },
      null,
      { intentId: 'pi-003', merchantId: 'merch-003', agentId: null, status: 'pending', createdAt: new Date().toISOString() },
    );

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.status).toBe('observed');
  });

  it('returns status:matched when settlement event is on_chain_confirmed (no resolution yet)', async () => {
    mockSettlementChain(
      { eventId: 'ev-004', intentId: 'pi-004', eventType: 'on_chain_confirmed', protocol: 'solana', createdAt: new Date().toISOString() },
      null,
      { intentId: 'pi-004', merchantId: 'merch-004', agentId: null, status: 'pending', createdAt: new Date().toISOString() },
    );

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.status).toBe('matched');
  });

  it('returns status:matched when settlement event is webhook_received (no resolution yet)', async () => {
    mockSettlementChain(
      { eventId: 'ev-005', intentId: 'pi-005', eventType: 'webhook_received', protocol: 'stripe', createdAt: new Date().toISOString() },
      null,
      { intentId: 'pi-005', merchantId: 'merch-005', agentId: null, status: 'pending', createdAt: new Date().toISOString() },
    );

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.status).toBe('matched');
  });

  it('returns status:unmatched when settlement event is policy_mismatch (no resolution)', async () => {
    mockSettlementChain(
      { eventId: 'ev-006', intentId: 'pi-006', eventType: 'policy_mismatch', protocol: 'solana', createdAt: new Date().toISOString() },
      null,
      { intentId: 'pi-006', merchantId: 'merch-006', agentId: null, status: 'failed', createdAt: new Date().toISOString() },
    );

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.status).toBe('unmatched');
  });

  // ── Resolution takes priority over raw event type ─────────────────────────

  it('uses resolution status even when event says on_chain_confirmed', async () => {
    mockSettlementChain(
      { eventId: 'ev-007', intentId: 'pi-007', eventType: 'on_chain_confirmed', protocol: 'solana', createdAt: new Date().toISOString() },
      { resolutionId: 'res-007', resolutionStatus: 'failed', decisionCode: 'underpaid', reasonCode: 'amount_mismatch', resolvedAt: new Date().toISOString() },
      { intentId: 'pi-007', merchantId: 'merch-007', agentId: null, status: 'failed', createdAt: new Date().toISOString() },
    );

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('unmatched');
    expect(res.body.verified).toBe(false);
    expect(res.body.reasonCode).toBe('amount_mismatch');
  });

  // ── HMAC signature ───────────────────────────────────────────────────────

  it('includes an HMAC signature in the response', async () => {
    mockLegacyTx(null);

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('signature');
    expect(typeof res.body.signature).toBe('string');
    expect(res.body.signature.length).toBeGreaterThan(0);
  });

  it('signature is valid HMAC-SHA256 of the payload', async () => {
    mockLegacyTx(null);

    const res = await request(app).get(`/api/verify/${VALID_EVM_HASH}`);
    const { signature, ...payload } = res.body;
    const expectedSig = crypto
      .createHmac('sha256', 'test-hmac-secret-for-verify-route')
      .update(JSON.stringify(payload))
      .digest('hex');
    expect(signature).toBe(expectedSig);
  });

  // ── Input validation ─────────────────────────────────────────────────────

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
    // The secret check happens before any DB queries, so no DB calls are made.
    // mockQuery is set as a catch-all to prevent any unexpected DB interaction.
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(app).get(`/api/verify/${VALID_SOLANA_HASH}`);
    expect(res.status).toBe(500);

    process.env.WEBHOOK_SECRET = savedSecret;
  });

  it('accepts EVM-style hex hash (64 chars)', async () => {
    mockLegacyTx(null);
    const res = await request(app).get(`/api/verify/${VALID_EVM_HASH}`);
    expect(res.status).toBe(200);
  });
});