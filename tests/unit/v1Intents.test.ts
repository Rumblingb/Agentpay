/**
 * Unit tests for the agent-facing POST /api/v1/payment-intents endpoint.
 * Prisma and db.query are mocked so no real DB is needed.
 */

// ---- Mock the db query function ----
jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
}));

// ---- Mock intentService so we don't need Prisma ----
jest.mock('../../src/services/intentService', () => ({
  createIntent: jest.fn(),
  getIntentStatus: jest.fn(),
  default: { createIntent: jest.fn(), getIntentStatus: jest.fn() },
}));

// ---- Mock spending policy service ----
jest.mock('../../src/services/spendingPolicyService', () => ({
  checkAndIncrementSpending: jest.fn().mockResolvedValue({
    allowed: true,
    spentToday: 0,
    dailyLimit: Infinity,
    remaining: Infinity,
  }),
  ensureSpendingPoliciesTable: jest.fn().mockResolvedValue(undefined),
  default: {
    checkAndIncrementSpending: jest.fn().mockResolvedValue({
      allowed: true,
      spentToday: 0,
      dailyLimit: Infinity,
      remaining: Infinity,
    }),
    ensureSpendingPoliciesTable: jest.fn().mockResolvedValue(undefined),
  },
}));

// ---- Mock Prisma to prevent ESM import issues ----
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
import * as db from '../../src/db/index';
import * as intentService from '../../src/services/intentService';
import * as spendingPolicy from '../../src/services/spendingPolicyService';

const mockQuery = db.query as jest.Mock;
const mockCreateIntent = intentService.createIntent as jest.Mock;
const mockCheckSpending = spendingPolicy.checkAndIncrementSpending as jest.Mock;

const VALID_MERCHANT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VALID_AGENT_ID = 'agent-wallet-abc123';
const MOCK_INTENT_RESULT = {
  intentId: 'intent-uuid-0001',
  verificationToken: 'APV_1700000000000_aabbccdd',
  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  instructions: {
    recipientAddress: '5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqD',
    memo: 'APV_1700000000000_aabbccdd',
    solanaPayUri: 'solana:5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqD?amount=10&spl-token=EPjFW...&memo=APV_1700000000000_aabbccdd',
  },
};

describe('POST /api/v1/payment-intents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: merchant found, no Stripe account
    mockQuery.mockResolvedValue({
      rows: [{
        id: VALID_MERCHANT_ID,
        wallet_address: '5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqD',
        webhook_url: 'https://merchant.example.com/webhook',
        stripe_connected_account_id: null,
      }],
    });
    mockCreateIntent.mockResolvedValue(MOCK_INTENT_RESULT);
  });

  it('returns 201 with intentId and crypto instructions', async () => {
    const res = await request(app)
      .post('/api/v1/payment-intents')
      .send({
        merchantId: VALID_MERCHANT_ID,
        agentId: VALID_AGENT_ID,
        amount: 10,
        currency: 'USDC',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.intentId).toBe(MOCK_INTENT_RESULT.intentId);
    expect(res.body.verificationToken).toBe(MOCK_INTENT_RESULT.verificationToken);
    expect(res.body.expiresAt).toBeDefined();
    expect(res.body.instructions.crypto).toBeDefined();
    expect(res.body.instructions.crypto.recipientAddress).toBe(
      MOCK_INTENT_RESULT.instructions.recipientAddress
    );
    expect(res.body.instructions.crypto.memo).toBe(MOCK_INTENT_RESULT.verificationToken);
  });

  it('embeds agentId in metadata when calling createIntent', async () => {
    await request(app)
      .post('/api/v1/payment-intents')
      .send({
        merchantId: VALID_MERCHANT_ID,
        agentId: VALID_AGENT_ID,
        amount: 5,
        currency: 'USDC',
      });

    expect(mockCreateIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: VALID_MERCHANT_ID,
        amount: 5,
        currency: 'USDC',
        metadata: expect.objectContaining({ agentId: VALID_AGENT_ID }),
      })
    );
  });

  it('returns 400 when merchantId is missing', async () => {
    const res = await request(app)
      .post('/api/v1/payment-intents')
      .send({ agentId: VALID_AGENT_ID, amount: 10, currency: 'USDC' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('returns 400 when agentId is missing', async () => {
    const res = await request(app)
      .post('/api/v1/payment-intents')
      .send({ merchantId: VALID_MERCHANT_ID, amount: 10, currency: 'USDC' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when amount is not positive', async () => {
    const res = await request(app)
      .post('/api/v1/payment-intents')
      .send({
        merchantId: VALID_MERCHANT_ID,
        agentId: VALID_AGENT_ID,
        amount: -5,
        currency: 'USDC',
      });

    expect(res.status).toBe(400);
  });

  it('returns 404 when merchant does not exist', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/api/v1/payment-intents')
      .send({
        merchantId: VALID_MERCHANT_ID,
        agentId: VALID_AGENT_ID,
        amount: 10,
        currency: 'USDC',
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/merchant not found/i);
  });

  it('includes fiat note when merchant has Stripe account', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        id: VALID_MERCHANT_ID,
        wallet_address: '5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqD',
        webhook_url: null,
        stripe_connected_account_id: 'acct_1234567890',
      }],
    });

    const res = await request(app)
      .post('/api/v1/payment-intents')
      .send({
        merchantId: VALID_MERCHANT_ID,
        agentId: VALID_AGENT_ID,
        amount: 10,
        currency: 'USDC',
      });

    expect(res.status).toBe(201);
    expect(res.body.instructions.fiat).toBeDefined();
    expect(res.body.instructions.fiat.provider).toBe('stripe');
  });

  it('does not include fiat instructions when merchant has no Stripe account', async () => {
    const res = await request(app)
      .post('/api/v1/payment-intents')
      .send({
        merchantId: VALID_MERCHANT_ID,
        agentId: VALID_AGENT_ID,
        amount: 10,
        currency: 'USDC',
      });

    expect(res.status).toBe(201);
    expect(res.body.instructions.fiat).toBeUndefined();
  });
});

describe('GET /api/v1/payment-intents/:intentId', () => {
  const validUuidIntentId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when intentId is not a valid UUID', async () => {
    const res = await request(app).get('/api/v1/payment-intents/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid intent id/i);
  });

  it('returns 400 when intentId is the string "undefined"', async () => {
    const res = await request(app).get('/api/v1/payment-intents/undefined');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid intent id/i);
  });

  it('returns 404 when intent does not exist', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(app).get(`/api/v1/payment-intents/${validUuidIntentId}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns intent details for a known intent', async () => {
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000);
    mockQuery.mockResolvedValue({
      rows: [{
        id: validUuidIntentId,
        merchant_id: VALID_MERCHANT_ID,
        amount: '10.000000',
        currency: 'USDC',
        status: 'pending',
        verification_token: 'APV_1700000000000_aabbccdd',
        expires_at: expiresAt,
        metadata: { agentId: VALID_AGENT_ID },
        created_at: new Date(),
      }],
    });

    const res = await request(app).get(`/api/v1/payment-intents/${validUuidIntentId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.intentId).toBe(validUuidIntentId);
    expect(res.body.status).toBe('pending');
    expect(res.body.metadata).toMatchObject({ agentId: VALID_AGENT_ID });
  });
});

describe('POST /api/v1/payment-intents — Spending Policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({
      rows: [{
        id: VALID_MERCHANT_ID,
        wallet_address: '5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqD',
        webhook_url: null,
        stripe_connected_account_id: null,
      }],
    });
    mockCreateIntent.mockResolvedValue(MOCK_INTENT_RESULT);
  });

  it('returns 429 when daily spending limit is reached', async () => {
    mockCheckSpending.mockResolvedValue({
      allowed: false,
      spentToday: 95,
      dailyLimit: 100,
      remaining: 5,
      reason: 'Daily spending limit reached.',
    });

    const res = await request(app)
      .post('/api/v1/payment-intents')
      .send({
        merchantId: VALID_MERCHANT_ID,
        agentId: VALID_AGENT_ID,
        amount: 10,
        currency: 'USDC',
      });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/daily spending limit/i);
    expect(res.body.spentToday).toBe(95);
    expect(res.body.dailyLimit).toBe(100);
    expect(mockCreateIntent).not.toHaveBeenCalled();
  });

  it('allows transaction when under spending limit', async () => {
    mockCheckSpending.mockResolvedValue({
      allowed: true,
      spentToday: 50,
      dailyLimit: 100,
      remaining: 40,
    });

    const res = await request(app)
      .post('/api/v1/payment-intents')
      .send({
        merchantId: VALID_MERCHANT_ID,
        agentId: VALID_AGENT_ID,
        amount: 10,
        currency: 'USDC',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(mockCreateIntent).toHaveBeenCalled();
  });

  it('still creates intent when spending policy table does not exist', async () => {
    const tableError = new Error('relation "spending_policies" does not exist');
    mockCheckSpending.mockRejectedValue(tableError);

    const res = await request(app)
      .post('/api/v1/payment-intents')
      .send({
        merchantId: VALID_MERCHANT_ID,
        agentId: VALID_AGENT_ID,
        amount: 10,
        currency: 'USDC',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});
