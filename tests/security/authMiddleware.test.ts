/**
 * Security tests for the auth middleware.
 *
 * Covers: missing header, empty key, literal "undefined"/"null" strings,
 * test-mode bypass, invalid format, injection-style strings.
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

jest.mock('../../src/services/merchants', () => ({
  authenticateMerchant: jest.fn(),
  getMerchant: jest.fn().mockResolvedValue(null), // returns null so profile falls back to middleware data
}));

import request from 'supertest';
import app from '../../src/server';
import * as merchantsService from '../../src/services/merchants';

const mockAuth = merchantsService.authenticateMerchant as jest.Mock;

// A protected endpoint we can hit for auth tests
const PROTECTED = '/api/merchants/me';

describe('Auth Middleware Security', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 AUTH_MISSING when no Authorization header', async () => {
    const res = await request(app).get(PROTECTED);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_MISSING');
  });

  it('returns 401 AUTH_MISSING when x-api-key header is empty string', async () => {
    const res = await request(app).get(PROTECTED).set('x-api-key', '');
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header is literal string "undefined"', async () => {
    const res = await request(app).get(PROTECTED).set('Authorization', 'undefined');
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header is literal string "null"', async () => {
    const res = await request(app).get(PROTECTED).set('Authorization', 'null');
    expect(res.status).toBe(401);
  });

  it('returns 401 AUTH_INVALID for a bogus API key', async () => {
    mockAuth.mockResolvedValueOnce({ merchant: null, reason: 'prefix_not_found' });
    const res = await request(app).get(PROTECTED).set('Authorization', 'invalid_key_xyz');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_INVALID');
  });

  it('accepts sk_test_sim_12345 in AGENTPAY_TEST_MODE without DB call', async () => {
    // test mode is already set in .env.test
    const res = await request(app).get(PROTECTED).set('Authorization', 'sk_test_sim_12345');
    // Should not fail with auth error (may fail with 404 if merchant doesn't exist in test DB)
    expect(res.status).not.toBe(401);
    expect(mockAuth).not.toHaveBeenCalled(); // bypass — no DB lookup
  });

  it('accepts sk_test_sim (short form) in AGENTPAY_TEST_MODE', async () => {
    const res = await request(app).get(PROTECTED).set('Authorization', 'sk_test_sim');
    expect(res.status).not.toBe(401);
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it('extracts key from Bearer token format', async () => {
    mockAuth.mockResolvedValueOnce({ merchant: null, reason: 'hash_mismatch' });
    const res = await request(app)
      .get(PROTECTED)
      .set('Authorization', 'Bearer some_valid_prefix_key');
    expect(mockAuth).toHaveBeenCalledWith('some_valid_prefix_key');
  });

  it('handles SQL-injection-style key strings without crashing', async () => {
    mockAuth.mockResolvedValueOnce({ merchant: null, reason: 'prefix_not_found' });
    const injectionKey = "'; DROP TABLE merchants; --";
    const res = await request(app).get(PROTECTED).set('Authorization', injectionKey);
    expect(res.status).toBe(401); // auth fails gracefully
  });

  it('handles very long key strings without crashing (DoS resistance)', async () => {
    mockAuth.mockResolvedValueOnce({ merchant: null, reason: 'prefix_not_found' });
    const longKey = 'a'.repeat(10000);
    const res = await request(app).get(PROTECTED).set('Authorization', longKey);
    expect(res.status).toBe(401);
  });

  it('returns 200 for a valid merchant key', async () => {
    mockAuth.mockResolvedValueOnce({
      merchant: {
        id: 'merchant-uuid-001',
        name: 'Test Merchant',
        email: 'test@example.com',
        walletAddress: 'wallet-addr',
        webhookUrl: null,
      },
    });
    const res = await request(app).get(PROTECTED).set('Authorization', 'valid_api_key_here');
    expect(res.status).toBe(200);
  });
});
