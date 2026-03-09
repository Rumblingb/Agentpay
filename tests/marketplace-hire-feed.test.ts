/**
 * Tests for the new marketplace hire flow, SSE feed, escrow service,
 * discovery service ranking, and liquidity service.
 *
 * FIX 1 – EscrowService
 * FIX 2 – POST /api/marketplace/hire + GET /api/marketplace/hires
 * FIX 3 – Discovery rankAgents / semantic sort modes
 * FIX 4 – Liquidity service runLiquidityCycle
 * FIX 5 – SSE feed route GET /api/feed/stream
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// ─── Prisma mock ──────────────────────────────────────────────────────────────
const mockPrismaAgentCreate = jest.fn();
const mockPrismaAgentFindFirst = jest.fn();
const mockPrismaAgentFindMany = jest.fn();
const mockPrismaAgentrankFindMany = jest.fn();
const mockPrismaAgentrankCount = jest.fn();
const mockPrismaAgentTransactionCreate = jest.fn();
const mockPrismaAgentTransactionFindMany = jest.fn();
const mockPrismaAgentTransactionUpdateMany = jest.fn();
const mockPrismaAgentWalletFindFirst = jest.fn();

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    agent: {
      create: (...args: any[]) => mockPrismaAgentCreate(...args),
      findFirst: (...args: any[]) => mockPrismaAgentFindFirst(...args),
      findMany: (...args: any[]) => mockPrismaAgentFindMany(...args),
    },
    agentrank_scores: {
      findMany: (...args: any[]) => mockPrismaAgentrankFindMany(...args),
      count: (...args: any[]) => mockPrismaAgentrankCount(...args),
    },
    agentTransaction: {
      create: (...args: any[]) => mockPrismaAgentTransactionCreate(...args),
      findMany: (...args: any[]) => mockPrismaAgentTransactionFindMany(...args),
      updateMany: (...args: any[]) => mockPrismaAgentTransactionUpdateMany(...args),
    },
    agent_wallets: {
      findFirst: (...args: any[]) => mockPrismaAgentWalletFindFirst(...args),
    },
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('vector not available')),
  },
}));

// ─── DB mock ──────────────────────────────────────────────────────────────────
const mockDbQuery = jest.fn();
jest.mock('../src/db/index', () => ({
  __esModule: true,
  query: (...args: any[]) => mockDbQuery(...args),
  pool: { on: jest.fn() },
  closePool: jest.fn(),
}));

// ─── intentService mock ───────────────────────────────────────────────────────
jest.mock('../src/services/intentService', () => ({
  __esModule: true,
  createIntent: jest.fn().mockResolvedValue({
    intentId: 'intent-test-123',
    verificationToken: 'tok-abc',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    instructions: {
      recipientAddress: 'SolAddr123',
      memo: 'tok-abc',
      solanaPayUri: 'solana:SolAddr123?amount=1.5',
    },
  }),
}));

// ─── agentrankService mock ────────────────────────────────────────────────────
jest.mock('../src/services/agentrankService', () => ({
  __esModule: true,
  adjustScore: jest.fn().mockResolvedValue({ score: 55, grade: 'C' }),
}));

// ─── auth middleware mock ─────────────────────────────────────────────────────
jest.mock('../src/middleware/auth', () => ({
  __esModule: true,
  authenticateApiKey: (req: any, _res: any, next: any) => {
    req.merchant = {
      id: 'merchant-test-id',
      name: 'Test Merchant',
      email: 'test@agentpay.com',
      walletAddress: 'WalletAddr123',
    };
    next();
  },
}));

import request from 'supertest';
import express from 'express';
import marketplaceRouter from '../src/routes/marketplace';
import feedRouter from '../src/routes/feed';
import { rankAgents } from '../src/services/discoveryService';
import { EscrowService } from '../src/services/escrowService';
import { runLiquidityCycle, stopLiquidityCron } from '../src/services/liquidityService';
import { broadcastMarketplaceEvent, getSseClientCount } from '../src/events/marketplaceEmitter';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/feed', feedRouter);

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockDbQuery.mockResolvedValue({ rows: [] });
  mockPrismaAgentrankFindMany.mockResolvedValue([]);
  mockPrismaAgentrankCount.mockResolvedValue(0);
  mockPrismaAgentCreate.mockResolvedValue({ id: 'agent-liq-1' });
  mockPrismaAgentFindFirst.mockResolvedValue(null);
  mockPrismaAgentWalletFindFirst.mockResolvedValue(null);
  mockPrismaAgentTransactionCreate.mockResolvedValue({ id: 'tx-1' });
  mockPrismaAgentTransactionFindMany.mockResolvedValue([]);
  mockPrismaAgentTransactionUpdateMany.mockResolvedValue({ count: 1 });
});

// ─── FIX 2: POST /api/marketplace/hire ───────────────────────────────────────

describe('POST /api/marketplace/hire', () => {
  it('creates a hire and returns escrowId + status', async () => {
    const res = await request(app)
      .post('/api/marketplace/hire')
      .send({
        agentIdToHire: 'agent-payee-123',
        amountUsd: 1.5,
        taskDescription: 'Summarize this paper',
        timeoutHours: 48,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.escrowId).toBeDefined();
    expect(res.body.status).toBeDefined();
  });

  it('rejects missing agentIdToHire', async () => {
    const res = await request(app)
      .post('/api/marketplace/hire')
      .send({ amountUsd: 1.0, taskDescription: 'Task' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('rejects zero amount', async () => {
    const res = await request(app)
      .post('/api/marketplace/hire')
      .send({ agentIdToHire: 'agent-123', amountUsd: 0, taskDescription: 'Task' });

    expect(res.status).toBe(400);
  });

  it('rejects negative amount', async () => {
    const res = await request(app)
      .post('/api/marketplace/hire')
      .send({ agentIdToHire: 'agent-123', amountUsd: -5, taskDescription: 'Task' });

    expect(res.status).toBe(400);
  });

  it('applies drain protection when wallet balance is set', async () => {
    // Mock a small wallet balance — $1.00 → 10% = $0.10 max
    mockPrismaAgentWalletFindFirst.mockResolvedValueOnce({ balance_usdc: '1.00' });

    const res = await request(app)
      .post('/api/marketplace/hire')
      .send({ agentIdToHire: 'agent-123', amountUsd: 0.5, taskDescription: 'Task' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/drain protection/i);
  });

  it('allows hire within drain limit', async () => {
    mockPrismaAgentWalletFindFirst.mockResolvedValueOnce({ balance_usdc: '100.00' });

    const res = await request(app)
      .post('/api/marketplace/hire')
      .send({ agentIdToHire: 'agent-123', amountUsd: 5.0, taskDescription: 'Task' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

// ─── FIX 2: GET /api/marketplace/hires ───────────────────────────────────────

describe('GET /api/marketplace/hires', () => {
  it('returns list of active hires', async () => {
    mockPrismaAgentTransactionFindMany.mockResolvedValue([
      {
        id: 'tx-1',
        escrowId: 'esc-1',
        sellerAgentId: 'seller-1',
        amount: 1.5,
        status: 'hired',
        task: { description: 'Summarize' },
        createdAt: new Date(),
      },
    ]);

    const res = await request(app).get('/api/marketplace/hires');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.hires).toHaveLength(1);
    expect(res.body.hires[0].escrowId).toBe('esc-1');
  });

  it('returns empty list when no hires', async () => {
    mockPrismaAgentTransactionFindMany.mockResolvedValue([]);

    const res = await request(app).get('/api/marketplace/hires');

    expect(res.status).toBe(200);
    expect(res.body.hires).toHaveLength(0);
  });
});

// ─── FIX 2: discover with new sort modes ────────────────────────────────────

describe('GET /api/marketplace/discover – new sort modes', () => {
  const AGENT_A = {
    agent_id: 'alpha',
    score: 900,
    grade: 'S',
    payment_reliability: '0.98',
    service_delivery: '0.95',
    transaction_volume: 500,
    wallet_age_days: 365,
    updated_at: new Date(),
  };

  beforeEach(() => {
    mockPrismaAgentrankFindMany.mockResolvedValue([AGENT_A]);
    mockPrismaAgentrankCount.mockResolvedValue(1);
  });

  it('accepts sortBy=best_match', async () => {
    const res = await request(app).get('/api/marketplace/discover?sortBy=best_match');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('accepts sortBy=cheapest', async () => {
    const res = await request(app).get('/api/marketplace/discover?sortBy=cheapest');
    expect(res.status).toBe(200);
  });

  it('accepts sortBy=fastest', async () => {
    const res = await request(app).get('/api/marketplace/discover?sortBy=fastest');
    expect(res.status).toBe(200);
  });

  it('rejects invalid sortBy', async () => {
    const res = await request(app).get('/api/marketplace/discover?sortBy=invalid_sort');
    expect(res.status).toBe(400);
  });
});

// ─── FIX 3: rankAgents ────────────────────────────────────────────────────────

describe('rankAgents()', () => {
  const candidates = [
    { agentId: 'a', handle: 'alpha', score: 900, grade: 'S', transactionVolume: 500, paymentReliability: 0.99, serviceDelivery: 0.95, updatedAt: new Date(), pricePerTask: 2.0, avgResponseTimeMs: 100 },
    { agentId: 'b', handle: 'beta',  score: 400, grade: 'C', transactionVolume: 50,  paymentReliability: 0.60, serviceDelivery: 0.60, updatedAt: new Date(), pricePerTask: 0.1, avgResponseTimeMs: 500 },
    { agentId: 'c', handle: 'gamma', score: 700, grade: 'A', transactionVolume: 200, paymentReliability: 0.85, serviceDelivery: 0.80, updatedAt: new Date(), pricePerTask: 1.0, avgResponseTimeMs: 200 },
  ];

  it('best_match ranks by score + reliability', () => {
    const result = rankAgents(candidates, 'best_match');
    expect(result[0].agentId).toBe('a'); // highest score
  });

  it('cheapest ranks by lowest price', () => {
    const result = rankAgents(candidates, 'cheapest');
    expect(result[0].agentId).toBe('b'); // lowest price
  });

  it('fastest ranks by lowest latency', () => {
    const result = rankAgents(candidates, 'fastest');
    expect(result[0].agentId).toBe('a'); // lowest latency
  });

  it('returns all candidates', () => {
    const result = rankAgents(candidates, 'best_match');
    expect(result).toHaveLength(3);
  });
});

// ─── FIX 1: EscrowService ─────────────────────────────────────────────────────

describe('EscrowService', () => {
  let svc: EscrowService;

  beforeEach(() => {
    svc = new EscrowService();
    svc._resetRegistry();
  });

  it('creates an internal escrow', async () => {
    const record = await svc.create({
      type: 'internal',
      fromAgentId: 'buyer-1',
      toAgentId: 'seller-1',
      amount: 1.0,
      taskDescription: 'Test task',
    });

    expect(record.escrowId).toBeDefined();
    expect(record.status).toBe('funded');
    expect(record.type).toBe('internal');
  });

  it('creates a solana escrow (with fallback)', async () => {
    const record = await svc.create({
      type: 'solana',
      fromAgentId: 'buyer-2',
      toAgentId: 'seller-2',
      amount: 0.5,
      taskDescription: 'Solana task',
    });

    expect(record.escrowId).toBeDefined();
    expect(record.amount).toBe(0.5);
  });

  it('creates a stripe escrow (placeholder)', async () => {
    const record = await svc.create({
      type: 'stripe',
      fromAgentId: 'buyer-3',
      toAgentId: 'seller-3',
      amount: 10.0,
      taskDescription: 'Stripe task',
    });

    expect(record.escrowId).toMatch(/^stripe_/);
    expect(record.status).toBe('funded');
  });

  it('releases an escrow', async () => {
    const record = await svc.create({
      type: 'internal',
      fromAgentId: 'buyer-4',
      toAgentId: 'seller-4',
      amount: 2.0,
      taskDescription: 'Release test',
    });

    const released = await svc.release(record.escrowId, 'buyer-4');
    expect(released?.status).toBe('released');
  });

  it('disputes an escrow', async () => {
    const record = await svc.create({
      type: 'internal',
      fromAgentId: 'buyer-5',
      toAgentId: 'seller-5',
      amount: 3.0,
      taskDescription: 'Dispute test',
    });

    const disputed = await svc.dispute(record.escrowId, 'buyer-5', 'Work not done', 'seller-5');
    expect(disputed?.status).toBe('disputed');
  });

  it('returns null for unknown escrowId', async () => {
    const result = svc.getRecord('nonexistent-id');
    expect(result).toBeNull();
  });

  it('throws for unsupported type', async () => {
    await expect(
      svc.create({ type: 'unknown' as any, fromAgentId: 'a', toAgentId: 'b', amount: 1, taskDescription: 'x' }),
    ).rejects.toThrow(/unsupported escrow type/i);
  });
});

// ─── FIX 4: Liquidity Service ─────────────────────────────────────────────────

describe('runLiquidityCycle()', () => {
  afterEach(() => {
    stopLiquidityCron();
  });

  it('completes without throwing', async () => {
    await expect(runLiquidityCycle()).resolves.not.toThrow();
  });
});

// ─── FIX 5: GET /api/feed/status ─────────────────────────────────────────────

describe('GET /api/feed/status', () => {
  it('returns connected client count', async () => {
    const res = await request(app).get('/api/feed/status');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.connectedClients).toBe('number');
  });
});

// ─── FIX 5: broadcastMarketplaceEvent ────────────────────────────────────────

describe('broadcastMarketplaceEvent()', () => {
  it('does not throw with no connected clients', () => {
    expect(() =>
      broadcastMarketplaceEvent({
        type: 'agent.hired',
        agentId: 'test-agent',
        amount: 1.0,
        timestamp: new Date().toISOString(),
      }),
    ).not.toThrow();
  });
});

// ─── FIX 5: getSseClientCount ────────────────────────────────────────────────

describe('getSseClientCount()', () => {
  it('returns a number', () => {
    expect(typeof getSseClientCount()).toBe('number');
  });
});
