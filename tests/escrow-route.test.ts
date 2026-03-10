/**
 * Tests for the escrow route production fixes:
 *   - Flexible payload (buyerId/sellerId/amount aliases)
 *   - Static POST /escrow/approve route
 *   - UUID-based escrow IDs
 *   - Validation error messages for missing fields
 *   - Score changes routed through recordTrustEvent (not adjustScore directly)
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// --- Mocks ---
jest.mock('../src/db/index', () => ({
  __esModule: true,
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  pool: { on: jest.fn() },
  closePool: jest.fn(),
}));

const mockTrustEventCreate = jest.fn().mockResolvedValue({});

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    agentrank_scores: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ score: 10, grade: 'F' }),
      create: jest.fn().mockResolvedValue({ score: 10, grade: 'F' }),
    },
    trustEvent: {
      create: (...args: any[]) => mockTrustEventCreate(...args),
    },
    escrow_transactions: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    transactions: {
      create: jest.fn().mockResolvedValue({}),
    },
    paymentIntent: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

jest.mock('../src/middleware/auth', () => ({
  __esModule: true,
  authenticateApiKey: jest.fn((req: any, _res: any, next: any) => {
    req.merchant = {
      id: '26e7ac4f-1234-4444-4444-121212121212',
      name: 'Test Merchant',
      email: 'test@example.com',
      walletAddress: 'TestWallet111',
    };
    next();
  }),
}));

jest.mock('../src/services/events', () => ({
  __esModule: true,
  emitEvent: jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import express from 'express';
import escrowRouter from '../src/routes/escrow';
import { _resetStore } from '../src/escrow/trust-escrow';

const app = express();
app.use(express.json());
app.use('/api/escrow', escrowRouter);

beforeEach(() => {
  _resetStore();
});

// ---------------------------------------------------------------------------
// POST /escrow/create — flexible payload aliases
// ---------------------------------------------------------------------------
describe('POST /api/escrow/create — flexible payload', () => {
  it('accepts canonical hiringAgent / workingAgent / amountUsdc', async () => {
    const res = await request(app).post('/api/escrow/create').send({
      hiringAgent: 'agent-A',
      workingAgent: 'agent-B',
      amountUsdc: 25.0,
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.escrow.hiringAgent).toBe('agent-A');
    expect(res.body.escrow.amountUsdc).toBe(25.0);
  });

  it('accepts buyerId / sellerId / amount aliases', async () => {
    const res = await request(app).post('/api/escrow/create').send({
      buyerId: 'buyer-001',
      sellerId: 'seller-002',
      amount: 50.0,
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.escrow.hiringAgent).toBe('buyer-001');
    expect(res.body.escrow.workingAgent).toBe('seller-002');
    expect(res.body.escrow.amountUsdc).toBe(50.0);
  });

  it('returns 400 when all required fields are missing', async () => {
    const res = await request(app).post('/api/escrow/create').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it('returns 400 when only hiringAgent is present', async () => {
    const res = await request(app)
      .post('/api/escrow/create')
      .send({ hiringAgent: 'agent-A' }); // missing workingAgent + amountUsdc
    expect(res.status).toBe(400);
    expect(res.body.details.some((m: string) => /workingAgent|sellerId/i.test(m))).toBe(true);
  });

  it('generates a valid UUID for escrow.id', async () => {
    const res = await request(app).post('/api/escrow/create').send({
      hiringAgent: 'agent-A',
      workingAgent: 'agent-B',
      amountUsdc: 10.0,
    });
    expect(res.status).toBe(201);
    // UUIDs match the pattern xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect(res.body.escrow.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

// ---------------------------------------------------------------------------
// POST /escrow/approve — static alias route
// ---------------------------------------------------------------------------
describe('POST /api/escrow/approve — static alias', () => {
  it('approves escrow by escrowId in body', async () => {
    // Create an escrow first
    const createRes = await request(app).post('/api/escrow/create').send({
      hiringAgent: 'A',
      workingAgent: 'B',
      amountUsdc: 100,
    });
    expect(createRes.status).toBe(201);
    const { id } = createRes.body.escrow;

    // Mark complete before approving
    await request(app)
      .post(`/api/escrow/${id}/complete`)
      .send({ callerAgent: 'B' });

    // Approve via static route
    const approveRes = await request(app).post('/api/escrow/approve').send({
      escrowId: id,
      callerAgent: 'A',
    });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.success).toBe(true);
    expect(approveRes.body.escrow.status).toBe('released');
  });

  it('returns 400 when escrowId is missing', async () => {
    const res = await request(app).post('/api/escrow/approve').send({
      callerAgent: 'A',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });
});

// ---------------------------------------------------------------------------
// POST /escrow/:id/approve — dynamic route still works
// ---------------------------------------------------------------------------
describe('POST /api/escrow/:id/approve — dynamic route', () => {
  it('approves via URL param ID', async () => {
    const createRes = await request(app).post('/api/escrow/create').send({
      hiringAgent: 'C',
      workingAgent: 'D',
      amountUsdc: 75,
    });
    const { id } = createRes.body.escrow;

    await request(app).post(`/api/escrow/${id}/complete`).send({ callerAgent: 'D' });

    const approveRes = await request(app)
      .post(`/api/escrow/${id}/approve`)
      .send({ callerAgent: 'C' });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.escrow.status).toBe('released');
  });
});

// ---------------------------------------------------------------------------
// Trust event routing — escrow operations must use recordTrustEvent
// not adjustScore, to ensure trust.score_updated is emitted via the
// canonical pipeline (exactly once per score change, in trust_events).
// ---------------------------------------------------------------------------
describe('Escrow trust event routing — canonical pipeline', () => {
  beforeEach(() => {
    _resetStore();
    mockTrustEventCreate.mockClear();
  });

  it('POST /escrow/approve writes two trust_events rows (service_execution + successful_interaction)', async () => {
    // Create and complete an escrow first
    const createRes = await request(app).post('/api/escrow/create').send({
      hiringAgent: 'hirer-x',
      workingAgent: 'worker-y',
      amountUsdc: 50,
    });
    const { id } = createRes.body.escrow;
    await request(app).post(`/api/escrow/${id}/complete`).send({ callerAgent: 'worker-y' });

    mockTrustEventCreate.mockClear();

    // Approve via static route
    const approveRes = await request(app)
      .post('/api/escrow/approve')
      .send({ escrowId: id, callerAgent: 'hirer-x' });

    expect(approveRes.status).toBe(200);

    // Exactly two trust_events rows — one per party
    expect(mockTrustEventCreate).toHaveBeenCalledTimes(2);

    const calls = mockTrustEventCreate.mock.calls.map((c: any) => c[0].data);

    // Hirer gets successful_interaction; worker gets service_execution
    const hirer = calls.find((d: any) => d.agentId === 'hirer-x');
    const worker = calls.find((d: any) => d.agentId === 'worker-y');

    expect(hirer).toBeDefined();
    expect(hirer.eventType).toBe('interaction.recorded');
    expect(hirer.delta).toBe(5);

    expect(worker).toBeDefined();
    expect(worker.eventType).toBe('service.completed');
    expect(worker.delta).toBe(10);
  });

  it('POST /escrow/:id/dispute writes exactly one trust_events row for the guilty party', async () => {
    const createRes = await request(app).post('/api/escrow/create').send({
      hiringAgent: 'hirer-a',
      workingAgent: 'worker-b',
      amountUsdc: 100,
    });
    const { id } = createRes.body.escrow;
    await request(app).post(`/api/escrow/${id}/complete`).send({ callerAgent: 'worker-b' });

    mockTrustEventCreate.mockClear();

    const disputeRes = await request(app).post(`/api/escrow/${id}/dispute`).send({
      callerAgent: 'hirer-a',
      reason: 'work not delivered',
      guiltyParty: 'worker-b',
    });

    expect(disputeRes.status).toBe(200);

    // Exactly one trust_events row for the guilty party
    expect(mockTrustEventCreate).toHaveBeenCalledTimes(1);

    const [call] = mockTrustEventCreate.mock.calls;
    const data = (call as any)[0].data;
    expect(data.agentId).toBe('worker-b');
    expect(data.eventType).toBe('dispute.resolved');
    expect(data.delta).toBe(-15); // dispute_resolved_guilty from catalog
  });
});
