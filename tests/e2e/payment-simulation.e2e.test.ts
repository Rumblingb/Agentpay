/**
 * AgentPay — Full Pre-Payment Simulation Suite
 *
 * Purpose: Verify the entire payment lifecycle end-to-end using mocked
 * infrastructure (no real DB, no Solana RPC, no Stripe, no external network).
 * Run this suite before any real-money payment to confirm every code path
 * behaves correctly.
 *
 * Coverage:
 *   1. Health & liveness checks
 *   2. Authentication (missing key, invalid key, test-mode bypass)
 *   3. AP2 full lifecycle  — request → receipt → confirm → status
 *   4. AP2 /payment alias  — forwards to /request
 *   5. AP2 error paths     — bad input, wrong status, receipt mismatch
 *   6. ACP pay → verify    — full flow + error paths
 *   7. Protocol detection  — body heuristics + X-Protocol header
 *   8. Escrow full flow    — create → complete → approve (in-memory)
 *   9. Escrow error paths  — missing fields, wrong-state transitions
 *  10. V1 payment intents  — create (201) + GET status (mocked DB)
 *  11. Test-mode simulate-tip — smoke-test the sk_test_sim_12345 key
 *  12. 404 JSON handler    — unknown routes return structured JSON
 */

// ---------------------------------------------------------------------------
// Module mocks — must come before any imports that load the mocked modules
// ---------------------------------------------------------------------------

// Prevent real DB connections in the pg pool
jest.mock('../../src/db/index', () => ({
  __esModule: true,
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
  pool: {
    on: jest.fn(),
    query: jest.fn(),
  },
}));

// Prisma real client uses import.meta.url (ESM-only) and needs a live DB.
// Route it through the project's existing lightweight mock.
jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    paymentIntent: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    transactions: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    merchant: {
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(null),
    },
    // Required by escrow routes (GET /escrow/:id cache-miss path)
    escrow_transactions: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
    },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $transaction: jest.fn().mockImplementation((ops: any) =>
      Array.isArray(ops) ? Promise.all(ops) : ops({}),
    ),
  },
}));

// Mock intentService to avoid DB calls in v1 intents routes
jest.mock('../../src/services/intentService', () => ({
  createIntent: jest.fn(),
  getIntentStatus: jest.fn(),
  default: { createIntent: jest.fn(), getIntentStatus: jest.fn() },
}));

// Prevent agentrankService from touching Prisma
jest.mock('../../src/services/agentrankService', () => ({
  adjustScore: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import request from 'supertest';
import app from '../../src/server';
import * as db from '../../src/db/index';
import * as intentService from '../../src/services/intentService';

const mockQuery = db.query as jest.Mock;
const mockCreateIntent = intentService.createIntent as jest.Mock;

// Signing secret required by the AP2 receipt endpoint
process.env.AGENTPAY_SIGNING_SECRET = 'sim-test-signing-secret-min-32-chars!!';
// Ensure test mode is on (also set by jest.setup.cjs, but be explicit here)
process.env.AGENTPAY_TEST_MODE = 'true';

// ---------------------------------------------------------------------------
// Helper: skip DB-related assertions when DB is not reachable
// ---------------------------------------------------------------------------
const dbAvailable = process.env.DB_AVAILABLE !== 'false';

// ============================================================
// 1. Health & liveness checks
// ============================================================
describe('Health & Liveness', () => {
  beforeEach(() => {
    // Health check does a SELECT 1 — mock it as if DB is up
    (db.pool as any).query = jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
  });

  it('GET / returns 200 plaintext liveness', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });

  it('GET /api returns 200 with API status payload', async () => {
    const res = await request(app).get('/api');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('AgentPay API Active');
    expect(res.body.version).toBe('1.0.0');
    expect(res.body.docs).toBe('/api/docs');
  });

  it('GET /health returns structured health payload', async () => {
    const res = await request(app).get('/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body.services).toHaveProperty('database');
    expect(res.body.services).toHaveProperty('agentrank');
    expect(res.body.services).toHaveProperty('escrow');
    expect(res.body.version).toBe('1.0.0');
  });

  it('GET /api/health returns the same shape as /health', async () => {
    const res = await request(app).get('/api/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
    expect(res.body.services).toHaveProperty('database');
    expect(res.body.version).toBe('1.0.0');
  });
});

// ============================================================
// 2. Authentication
// ============================================================
describe('Authentication', () => {
  it('returns 401 AUTH_MISSING when no Authorization header is sent', async () => {
    const res = await request(app).get('/api/merchants/profile');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_MISSING');
  });

  it('returns 401 AUTH_INVALID for a completely bogus API key', async () => {
    // The real merchantsService will fail — mock the DB to return no rows
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/merchants/profile')
      .set('Authorization', 'Bearer totally-invalid-key-xyz-9999');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_INVALID');
  });

  it('accepts sk_test_sim_12345 in test mode without hitting the DB', async () => {
    // The simulate-tip endpoint requires auth and is only mounted in test mode
    const res = await request(app)
      .post('/api/test/simulate-tip')
      .set('Authorization', 'Bearer sk_test_sim_12345')
      .send({ amount: 0.5 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.event).toBe('tip_received');
  });

  it('also accepts the shorter sk_test_sim alias', async () => {
    const res = await request(app)
      .post('/api/test/simulate-tip')
      .set('Authorization', 'Bearer sk_test_sim')
      .send({ amount: 1.0 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ============================================================
// 3. AP2 Full Lifecycle — request → receipt → confirm → status
// ============================================================
describe('AP2 Full Lifecycle (no DB)', () => {
  let requestId: string;
  let receiptId: string;

  // ── Step 1: create a payment request ──────────────────────
  describe('Step 1 – Create Payment Request', () => {
    it('POST /api/ap2/request returns 201 with requestId', async () => {
      const res = await request(app).post('/api/ap2/request').send({
        payerId: 'payer-sim-agent',
        payeeId: 'payee-sim-service',
        amountUsdc: 1.00,
        taskDescription: 'Fetch latest BTC/USDC price from oracle',
        ttlSeconds: 600,
        metadata: { jobId: 'sim-job-001', env: 'simulation' },
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.requestId).toBe('string');
      expect(res.body.requestId.length).toBeGreaterThan(0);
      expect(res.body.transaction.status).toBe('pending_receipt');
      expect(res.body.transaction.amountUsdc).toBe(1.00);
      expect(res.body.transaction.payerId).toBe('payer-sim-agent');
      expect(res.body.transaction.payeeId).toBe('payee-sim-service');
      expect(res.body.transaction.protocol).toBe('ap2');
      expect(res.body.nextStep).toBe('payee_issues_receipt');

      requestId = res.body.requestId;
    });

    it('newly-created request is visible via GET /api/ap2/status/:id', async () => {
      const res = await request(app).get(`/api/ap2/status/${requestId}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.transaction.status).toBe('pending_receipt');
      expect(res.body.transaction.requestId).toBe(requestId);
    });
  });

  // ── Step 2: payee issues receipt ──────────────────────────
  describe('Step 2 – Issue Receipt', () => {
    it('POST /api/ap2/receipt returns 201 with signed receipt', async () => {
      const res = await request(app).post('/api/ap2/receipt').send({
        requestId,
        payeeSignature: 'sim-payee-sig-abcdef1234',
        completionProof: 'sha256:aabbcc112233simproof',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.receipt.requestId).toBe(requestId);
      expect(typeof res.body.receipt.receiptId).toBe('string');
      expect(typeof res.body.receipt.serverSignature).toBe('string');
      expect(res.body.receipt.serverSignature.length).toBeGreaterThan(10);
      expect(res.body.receipt.payeeSignature).toBe('sim-payee-sig-abcdef1234');
      expect(res.body.nextStep).toBe('payer_confirms');

      receiptId = res.body.receipt.receiptId;
    });

    it('status transitions to pending_confirmation after receipt', async () => {
      const res = await request(app).get(`/api/ap2/status/${requestId}`);
      expect(res.status).toBe(200);
      expect(res.body.transaction.status).toBe('pending_confirmation');
    });

    it('cannot re-issue a receipt for a transaction already in pending_confirmation', async () => {
      const res = await request(app).post('/api/ap2/receipt').send({
        requestId,
        payeeSignature: 'another-sig',
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/cannot issue receipt/i);
    });
  });

  // ── Step 3: payer confirms ─────────────────────────────────
  describe('Step 3 – Confirm Payment', () => {
    it('POST /api/ap2/confirm returns 200 with completed transaction', async () => {
      const res = await request(app).post('/api/ap2/confirm').send({
        requestId,
        receiptId,
        payerConfirmation: 'payer-signed-final-approval-sim',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.transaction.status).toBe('completed');
      expect(res.body.transaction.requestId).toBe(requestId);
      expect(res.body.message).toMatch(/funds released/i);
    });

    it('status is completed after confirmation', async () => {
      const res = await request(app).get(`/api/ap2/status/${requestId}`);
      expect(res.status).toBe(200);
      expect(res.body.transaction.status).toBe('completed');
    });

    it('returns 409 when confirming an already-completed transaction', async () => {
      const res = await request(app).post('/api/ap2/confirm').send({
        requestId,
        receiptId,
        payerConfirmation: 'duplicate-confirm-attempt',
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/completed/i);
    });
  });
});

// ============================================================
// 4. AP2 /payment alias
// ============================================================
describe('AP2 /payment convenience alias', () => {
  it('POST /api/ap2/payment behaves identically to /api/ap2/request', async () => {
    const res = await request(app).post('/api/ap2/payment').send({
      payerId: 'alias-payer',
      payeeId: 'alias-payee',
      amountUsdc: 2.50,
      taskDescription: 'Test alias endpoint',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.transaction.status).toBe('pending_receipt');
    expect(res.body.transaction.amountUsdc).toBe(2.50);
  });
});

// ============================================================
// 5. AP2 Error Paths
// ============================================================
describe('AP2 Error Paths', () => {
  it('returns 400 when payerId is missing', async () => {
    const res = await request(app).post('/api/ap2/request').send({
      payeeId: 'payee-x',
      amountUsdc: 5.0,
      taskDescription: 'Missing payer',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    expect(res.body.protocol).toBe('ap2');
  });

  it('returns 400 when amountUsdc exceeds maximum (100 000)', async () => {
    const res = await request(app).post('/api/ap2/request').send({
      payerId: 'p1',
      payeeId: 'p2',
      amountUsdc: 200_000,
      taskDescription: 'Way over max',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when amountUsdc is zero', async () => {
    const res = await request(app).post('/api/ap2/request').send({
      payerId: 'p1',
      payeeId: 'p2',
      amountUsdc: 0,
      taskDescription: 'Zero amount',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when requesting a receipt for a non-existent requestId', async () => {
    const res = await request(app).post('/api/ap2/receipt').send({
      requestId: '00000000-0000-0000-0000-000000000000',
      payeeSignature: 'sig-for-nobody',
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 400 when confirm is called with a receipt ID mismatch', async () => {
    // Create a fresh request
    const reqRes = await request(app).post('/api/ap2/request').send({
      payerId: 'mismatch-payer',
      payeeId: 'mismatch-payee',
      amountUsdc: 3.0,
      taskDescription: 'Receipt mismatch test',
    });
    const id = reqRes.body.requestId;

    // Issue a real receipt
    const rcptRes = await request(app).post('/api/ap2/receipt').send({
      requestId: id,
      payeeSignature: 'real-sig',
    });
    expect(rcptRes.status).toBe(201);

    // Confirm with a wrong (but validly-formatted v4) receiptId — should be 400 "Receipt ID mismatch"
    // Use a UUID distinct from any other constant in this file to avoid confusion.
    const WRONG_RECEIPT_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const res = await request(app).post('/api/ap2/confirm').send({
      requestId: id,
      receiptId: WRONG_RECEIPT_ID,
      payerConfirmation: 'wrong-confirm',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/receipt id mismatch/i);
  });

  it('returns 404 for an unknown status lookup', async () => {
    const res = await request(app).get('/api/ap2/status/does-not-exist-xyz');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('GET /api/ap2/schema returns the AP2 schema document', async () => {
    const res = await request(app).get('/api/ap2/schema');
    expect(res.status).toBe(200);
    expect(res.body.protocol).toBe('ap2');
    expect(res.body.version).toBe('2.0');
    expect(res.body.flow).toEqual(['request → receipt → confirm']);
    expect(res.body.endpoints).toHaveProperty('request');
    expect(res.body.endpoints).toHaveProperty('confirm');
  });
});

// ============================================================
// 6. ACP Pay → Verify Full Flow
// ============================================================
describe('ACP Full Flow (no DB)', () => {
  let paymentToken: string;

  it('POST /api/acp/pay returns 201 with pending receipt', async () => {
    const res = await request(app).post('/api/acp/pay').send({
      senderId: 'acp-sender-sim-001',
      recipientId: 'acp-receiver-sim-001',
      amountUsd: 0.50,
      purpose: 'Simulation: weather data API call',
      metadata: { simulation: true },
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.receipt.protocol).toBe('acp');
    expect(res.body.receipt.status).toBe('pending');
    expect(typeof res.body.receipt.paymentToken).toBe('string');
    expect(res.body.receipt.paymentToken.length).toBeGreaterThan(10);
    expect(res.body._acpMessage.senderId).toBe('acp-sender-sim-001');
    expect(res.body._acpMessage.amountUsd).toBe(0.50);

    paymentToken = res.body.receipt.paymentToken;
  });

  it('POST /api/acp/verify verifies the returned token successfully', async () => {
    const res = await request(app).post('/api/acp/verify').send({
      paymentToken,
      senderId: 'acp-sender-sim-001',
      expectedAmountUsd: 0.50,
    });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.protocol).toBe('acp');
  });

  it('GET /api/acp/schema returns the ACP schema', async () => {
    const res = await request(app).get('/api/acp/schema');
    expect(res.status).toBe(200);
    expect(res.body.protocol).toBe('acp');
    expect(res.body.version).toBe('1.0');
    expect(res.body.endpoints).toHaveProperty('pay');
    expect(res.body.endpoints).toHaveProperty('verify');
  });
});

// ============================================================
// 7. ACP Error Paths
// ============================================================
describe('ACP Error Paths', () => {
  it('returns 400 when senderId is missing', async () => {
    const res = await request(app).post('/api/acp/pay').send({
      recipientId: 'agent-b',
      amountUsd: 1.0,
      purpose: 'Test',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    expect(res.body.protocol).toBe('acp');
  });

  it('returns 400 when amountUsd is negative', async () => {
    const res = await request(app).post('/api/acp/pay').send({
      senderId: 'agent-a',
      recipientId: 'agent-b',
      amountUsd: -1.0,
      purpose: 'Negative test',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when paymentToken is too short for verify', async () => {
    const res = await request(app).post('/api/acp/verify').send({
      paymentToken: 'short',
      senderId: 'agent-a',
    });
    expect(res.status).toBe(400);
    expect(res.body.verified).toBe(false);
  });

  it('includes custom messageId in receipt when provided', async () => {
    const res = await request(app).post('/api/acp/pay').send({
      messageId: 'sim-msg-custom-99',
      senderId: 'agent-a',
      recipientId: 'agent-b',
      amountUsd: 1.0,
      purpose: 'Custom messageId test',
    });
    expect(res.status).toBe(201);
    expect(res.body.receipt.messageId).toBe('sim-msg-custom-99');
  });
});

// ============================================================
// 8. Protocol Detection
// ============================================================
describe('Protocol Detection', () => {
  it('detects ACP from body fields (senderId + recipientId + amountUsd)', async () => {
    const res = await request(app).post('/api/protocol/detect').send({
      senderId: 'agent-sender',
      recipientId: 'agent-receiver',
      amountUsd: 5.0,
    });
    expect(res.status).toBe(200);
    expect(res.body.detectedProtocol).toBe('acp');
  });

  it('detects AP2 from body fields (payerId + payeeId + amountUsdc)', async () => {
    const res = await request(app).post('/api/protocol/detect').send({
      payerId: 'p1',
      payeeId: 'p2',
      amountUsdc: 10.0,
    });
    expect(res.status).toBe(200);
    expect(res.body.detectedProtocol).toBe('ap2');
  });

  it('respects X-Protocol header override', async () => {
    const res = await request(app)
      .post('/api/protocol/detect')
      .set('X-Protocol', 'stripe')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.detectedProtocol).toBe('stripe');
  });

  it('defaults to x402 for unrecognised body shape', async () => {
    const res = await request(app).post('/api/protocol/detect').send({
      unknownField: 'value',
    });
    expect(res.status).toBe(200);
    expect(res.body.detectedProtocol).toBe('x402');
  });

  it('GET /api/protocol lists all supported protocols', async () => {
    const res = await request(app).get('/api/protocol');
    expect(res.status).toBe(200);
    expect(res.body.supportedProtocols).toContain('x402');
    expect(res.body.supportedProtocols).toContain('acp');
    expect(res.body.supportedProtocols).toContain('ap2');
    expect(res.body.supportedProtocols).toContain('solana');
    expect(res.body.supportedProtocols).toContain('stripe');
  });
});

// ============================================================
// 9. Escrow Full Flow (in-memory, no DB)
// ============================================================
describe('Escrow Full Flow (in-memory)', () => {
  let escrowId: string;

  // The escrow routes persist to DB best-effort; mock the query so it never errors
  beforeEach(() => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('POST /api/escrow/create returns 201 with escrowId', async () => {
    const res = await request(app)
      .post('/api/escrow/create')
      .set('Authorization', 'Bearer sk_test_sim_12345')
      .send({
        hiringAgent: 'hiring-sim-001',
        workingAgent: 'working-sim-001',
        amountUsdc: 5.00,
        workDescription: 'Build an E2E test harness',
        deadlineHours: 24,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.escrow.id).toBe('string');
    expect(res.body.escrow.status).toBe('funded');
    expect(res.body.escrow.amountUsdc).toBe(5.00);

    escrowId = res.body.escrow.id;
  });

  it('GET /api/escrow/:id returns the funded escrow', async () => {
    const res = await request(app).get(`/api/escrow/${escrowId}`);
    expect(res.status).toBe(200);
    expect(res.body.escrow.id).toBe(escrowId);
    expect(res.body.escrow.status).toBe('funded');
  });

  it('POST /api/escrow/:id/complete transitions status to completed', async () => {
    const res = await request(app)
      .post(`/api/escrow/${escrowId}/complete`)
      .send({ callerAgent: 'working-sim-001' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.escrow.status).toBe('completed');
  });

  it('POST /api/escrow/:id/approve transitions status to released', async () => {
    const res = await request(app)
      .post(`/api/escrow/${escrowId}/approve`)
      .set('Authorization', 'Bearer sk_test_sim_12345')
      .send({ callerAgent: 'hiring-sim-001' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.escrow.status).toBe('released');
  });

  it('GET /api/escrow/stats returns aggregate statistics', async () => {
    const res = await request(app).get('/api/escrow/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalEscrows');
    expect(res.body).toHaveProperty('totalReleasedUsdc');
  });
});

// ============================================================
// 10. Escrow Error Paths
// ============================================================
describe('Escrow Error Paths', () => {
  beforeEach(() => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('returns 400 when hiringAgent is missing', async () => {
    const res = await request(app)
      .post('/api/escrow/create')
      .set('Authorization', 'Bearer sk_test_sim_12345')
      .send({
        workingAgent: 'w1',
        amountUsdc: 1.0,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('returns 400 when amountUsdc is zero', async () => {
    const res = await request(app)
      .post('/api/escrow/create')
      .set('Authorization', 'Bearer sk_test_sim_12345')
      .send({ hiringAgent: 'h1', workingAgent: 'w1', amountUsdc: 0 });
    expect(res.status).toBe(400);
  });

  it('returns 404 when escrow ID does not exist', async () => {
    const res = await request(app).get('/api/escrow/non-existent-escrow-id-sim');
    expect(res.status).toBe(404);
  });

  it('returns 400 when approving an escrow that is still funded (not yet completed)', async () => {
    // Create a brand-new escrow and try to approve it immediately (wrong state)
    const create = await request(app)
      .post('/api/escrow/create')
      .set('Authorization', 'Bearer sk_test_sim_12345')
      .send({
        hiringAgent: 'h-premature',
        workingAgent: 'w-premature',
        amountUsdc: 1.0,
        deadlineHours: 1,
      });
    expect(create.status).toBe(201);
    const id = create.body.escrow.id;

    // /:id/approve requires auth; work has not been marked complete → should 400
    const approveRes = await request(app)
      .post(`/api/escrow/${id}/approve`)
      .set('Authorization', 'Bearer sk_test_sim_12345')
      .send({ callerAgent: 'h-premature' });

    expect(approveRes.status).toBe(400);
    expect(approveRes.body.error).toMatch(/not been marked as complete/i);
  });
});

// ============================================================
// 11. V1 Payment Intents (mocked DB)
// ============================================================
describe('V1 Payment Intents (mocked DB)', () => {
  const MERCHANT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const AGENT_ID = 'sim-agent-wallet-001';
  const MOCK_INTENT = {
    intentId: 'intent-sim-0001',
    verificationToken: 'APV_sim_1700000000000_aabbccdd',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    instructions: {
      recipientAddress: '9B5X2Fwc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8H',
      memo: 'APV_sim_1700000000000_aabbccdd',
      solanaPayUri:
        'solana:9B5X2Fwc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8H?amount=1&spl-token=EPjFWmdxuBgl1SdCaE7w8PKkzZBHYKb4YFPqsczYqkb&memo=APV_sim',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({
      rows: [{
        id: MERCHANT_ID,
        wallet_address: '9B5X2Fwc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8H',
        webhook_url: 'https://merchant.example.com/webhook',
        stripe_connected_account_id: null,
      }],
    });
    mockCreateIntent.mockResolvedValue(MOCK_INTENT);
  });

  it('POST /api/v1/payment-intents returns 201 with Solana pay URI', async () => {
    const res = await request(app)
      .post('/api/v1/payment-intents')
      .send({
        merchantId: MERCHANT_ID,
        agentId: AGENT_ID,
        amount: 1.00,
        currency: 'USDC',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.intentId).toBe(MOCK_INTENT.intentId);
    expect(res.body.verificationToken).toBe(MOCK_INTENT.verificationToken);
    expect(res.body.instructions.crypto).toBeDefined();
    expect(res.body.instructions.crypto.recipientAddress).toBe(
      MOCK_INTENT.instructions.recipientAddress,
    );
    expect(res.body.instructions.crypto.memo).toBe(MOCK_INTENT.verificationToken);
  });

  it('embeds agentId in metadata when creating an intent', async () => {
    await request(app)
      .post('/api/v1/payment-intents')
      .send({ merchantId: MERCHANT_ID, agentId: AGENT_ID, amount: 1.00, currency: 'USDC' });

    expect(mockCreateIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: MERCHANT_ID,
        amount: 1.00,
        currency: 'USDC',
        metadata: expect.objectContaining({ agentId: AGENT_ID }),
      }),
    );
  });

  it('returns 400 when merchantId is missing', async () => {
    const res = await request(app)
      .post('/api/v1/payment-intents')
      .send({ agentId: AGENT_ID, amount: 1.0, currency: 'USDC' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('returns 400 when amount is negative', async () => {
    const res = await request(app)
      .post('/api/v1/payment-intents')
      .send({ merchantId: MERCHANT_ID, agentId: AGENT_ID, amount: -5, currency: 'USDC' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when merchant does not exist', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post('/api/v1/payment-intents')
      .send({ merchantId: MERCHANT_ID, agentId: AGENT_ID, amount: 1.0, currency: 'USDC' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/merchant not found/i);
  });

  it('returns 400 for non-UUID intentId on GET', async () => {
    const res = await request(app).get('/api/v1/payment-intents/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid intent id/i);
  });
});

// ============================================================
// 12. Test-mode simulate-tip smoke test
// ============================================================
describe('Test-mode simulate-tip', () => {
  it('returns a simulated tip_received payload for default amount', async () => {
    const res = await request(app)
      .post('/api/test/simulate-tip')
      .set('Authorization', 'Bearer sk_test_sim_12345')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.event).toBe('tip_received');
    expect(typeof res.body.tipId).toBe('string');
    expect(res.body.currency).toBe('USDC');
    expect(res.body.amount).toBe(1.00);
    expect(res.body.note).toMatch(/simulated/i);
  });

  it('accepts a custom amount', async () => {
    const res = await request(app)
      .post('/api/test/simulate-tip')
      .set('Authorization', 'Bearer sk_test_sim_12345')
      .send({ amount: 2.50 });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(2.50);
    // Fee is 5%; net amount received should be 95% of tip
    expect(res.body.botReceives).toBeCloseTo(2.50 * 0.95, 4);
    expect(res.body.fee).toBeCloseTo(2.50 * 0.05, 4);
  });
});

// ============================================================
// 13. 404 JSON Handler
// ============================================================
describe('404 JSON handler', () => {
  it('unknown routes return structured JSON 404 (not HTML)', async () => {
    const res = await request(app).get('/api/sim-nonexistent-route-xyz-9999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
    expect(res.body.docs).toBe('/api/docs');
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('unknown non-API routes also return 404 JSON', async () => {
    const res = await request(app).get('/sim-completely-unknown');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });
});
