/**
 * Tests for the AgentPay Network agent routes:
 * - POST /api/agents/register
 * - GET  /api/agents/discover
 * - POST /api/agents/hire
 * - POST /api/agents/complete
 * - GET  /api/agents/feed
 * - GET  /api/agents/leaderboard
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// ─── Prisma mock ──────────────────────────────────────────────────────────────
const mockAgentCreate = jest.fn();
const mockAgentFindMany = jest.fn();
const mockAgentFindUnique = jest.fn();
const mockAgentUpdateMany = jest.fn();
const mockTxCreate = jest.fn();
const mockTxFindUnique = jest.fn();
const mockTxUpdate = jest.fn();
const mockTxFindMany = jest.fn();
const mockEscrowCreate = jest.fn();
const mockEscrowUpdate = jest.fn();

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    agent: {
      create: (...args: any[]) => mockAgentCreate(...args),
      findMany: (...args: any[]) => mockAgentFindMany(...args),
      findUnique: (...args: any[]) => mockAgentFindUnique(...args),
      updateMany: (...args: any[]) => mockAgentUpdateMany(...args),
    },
    agentTransaction: {
      create: (...args: any[]) => mockTxCreate(...args),
      findUnique: (...args: any[]) => mockTxFindUnique(...args),
      update: (...args: any[]) => mockTxUpdate(...args),
      findMany: (...args: any[]) => mockTxFindMany(...args),
    },
    agentEscrow: {
      create: (...args: any[]) => mockEscrowCreate(...args),
      update: (...args: any[]) => mockEscrowUpdate(...args),
    },
  },
}));

// ─── Auth middleware mock (skip auth in tests) ────────────────────────────────
jest.mock('../src/middleware/auth', () => ({
  authenticateApiKey: (req: any, _res: any, next: any) => {
    req.merchant = { id: 'merchant-test-id', name: 'Test Merchant' };
    next();
  },
}));

// ─── DB mock (not used in network routes, stub pool) ─────────────────────────
jest.mock('../src/db/index', () => ({
  __esModule: true,
  query: jest.fn(),
  pool: { on: jest.fn() },
  closePool: jest.fn(),
}));

import request from 'supertest';
import express from 'express';
import agentsRouter from '../src/routes/agents';

const app = express();
app.use(express.json());
app.use('/api/agents', agentsRouter);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/agents/register', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers an agent and returns agentId', async () => {
    mockAgentCreate.mockResolvedValue({
      id: 'agent-cuid-123',
      displayName: 'TestAgent',
      service: 'web-scraping',
      endpointUrl: 'https://test.example.com/execute',
      merchantId: 'merchant-test-id',
    });

    const res = await request(app)
      .post('/api/agents/register')
      .set('Authorization', 'Bearer sk_test_sim_12345')
      .send({
        name: 'TestAgent',
        service: 'web-scraping',
        endpointUrl: 'https://test.example.com/execute',
        pricing: { base: 1.5 },
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.agentId).toBe('agent-cuid-123');
    expect(res.body.name).toBe('TestAgent');
    expect(mockAgentCreate).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/api/agents/register')
      .set('Authorization', 'Bearer sk_test_sim_12345')
      .send({ name: 'NoService' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('returns 400 for invalid endpoint URL', async () => {
    const res = await request(app)
      .post('/api/agents/register')
      .set('Authorization', 'Bearer sk_test_sim_12345')
      .send({
        name: 'Agent',
        service: 'test',
        endpointUrl: 'not-a-url',
      });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/agents/discover', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns list of agents', async () => {
    mockAgentFindMany.mockResolvedValue([
      {
        id: 'agent-1',
        displayName: 'ScraperAgent',
        service: 'web-scraping',
        pricingModel: { base: 0.5 },
        rating: 4.8,
        totalEarnings: 120.5,
        tasksCompleted: 241,
        createdAt: new Date('2024-01-01'),
      },
    ]);

    const res = await request(app).get('/api/agents/discover');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.agents).toHaveLength(1);
    expect(res.body.agents[0].agentId).toBe('agent-1');
  });

  it('filters by maxPrice', async () => {
    mockAgentFindMany.mockResolvedValue([
      {
        id: 'agent-cheap',
        displayName: 'CheapAgent',
        service: 'scraping',
        pricingModel: { base: 0.5 },
        rating: 5.0,
        totalEarnings: 10,
        tasksCompleted: 20,
        createdAt: new Date(),
      },
      {
        id: 'agent-expensive',
        displayName: 'ExpensiveAgent',
        service: 'scraping',
        pricingModel: { base: 10.0 },
        rating: 4.9,
        totalEarnings: 500,
        tasksCompleted: 50,
        createdAt: new Date(),
      },
    ]);

    const res = await request(app).get('/api/agents/discover?maxPrice=1.0');

    expect(res.status).toBe(200);
    expect(res.body.agents).toHaveLength(1);
    expect(res.body.agents[0].agentId).toBe('agent-cheap');
  });
});

describe('POST /api/agents/hire', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a transaction and escrow', async () => {
    mockAgentFindUnique.mockResolvedValue({
      id: 'seller-agent-id',
      endpointUrl: 'https://seller.example.com/execute',
      service: 'web-scraping',
    });

    mockEscrowCreate.mockResolvedValue({ id: 'escrow-123' });
    mockTxCreate.mockResolvedValue({ id: 'tx-456', amount: 2.0 });
    mockEscrowUpdate.mockResolvedValue({ id: 'escrow-123' });

    const res = await request(app)
      .post('/api/agents/hire')
      .set('Authorization', 'Bearer sk_test_sim_12345')
      .send({
        buyerAgentId: 'buyer-agent-id',
        sellerAgentId: 'seller-agent-id',
        task: { type: 'scrape', url: 'https://example.com' },
        amount: 2.0,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.transactionId).toBe('tx-456');
    expect(res.body.status).toBe('running');
  });

  it('returns 404 if seller agent not found', async () => {
    mockAgentFindUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/agents/hire')
      .set('Authorization', 'Bearer sk_test_sim_12345')
      .send({
        buyerAgentId: 'buyer-id',
        sellerAgentId: 'nonexistent-seller',
        task: { type: 'test' },
        amount: 1.0,
      });

    expect(res.status).toBe(404);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/api/agents/hire')
      .set('Authorization', 'Bearer sk_test_sim_12345')
      .send({ buyerAgentId: 'buyer' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });
});

describe('POST /api/agents/complete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks transaction complete and releases escrow', async () => {
    mockTxFindUnique.mockResolvedValue({
      id: 'tx-456',
      status: 'running',
      sellerAgentId: 'seller-id',
      escrowId: 'escrow-123',
      amount: 2.0,
    });
    mockTxUpdate.mockResolvedValue({ id: 'tx-456', status: 'completed' });
    mockEscrowUpdate.mockResolvedValue({ id: 'escrow-123', status: 'released' });
    mockAgentUpdateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/agents/complete')
      .send({ transactionId: 'tx-456', output: { result: 'done' } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('completed');
    expect(res.body.escrowStatus).toBe('released');
    expect(mockAgentUpdateMany).toHaveBeenCalledWith({
      where: { id: 'seller-id' },
      data: {
        totalEarnings: { increment: 2.0 },
        tasksCompleted: { increment: 1 },
      },
    });
  });

  it('returns 404 for unknown transaction', async () => {
    mockTxFindUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/agents/complete')
      .send({ transactionId: 'nonexistent-tx' });

    expect(res.status).toBe(404);
  });

  it('handles already-completed transactions gracefully', async () => {
    mockTxFindUnique.mockResolvedValue({
      id: 'tx-done',
      status: 'completed',
    });

    const res = await request(app)
      .post('/api/agents/complete')
      .send({ transactionId: 'tx-done' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Already completed');
  });
});

describe('GET /api/agents/feed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns live transaction feed', async () => {
    mockTxFindMany.mockResolvedValue([
      {
        id: 'tx-1',
        buyerAgentId: 'buyer-1',
        sellerAgentId: 'seller-1',
        amount: 1.5,
        status: 'completed',
        createdAt: new Date('2024-01-01T12:00:00Z'),
      },
    ]);

    const res = await request(app).get('/api/agents/feed');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.feed).toHaveLength(1);
    expect(res.body.feed[0].buyer).toBe('buyer-1');
    expect(res.body.feed[0].amount).toBe(1.5);
  });

  it('returns empty feed when no transactions', async () => {
    mockTxFindMany.mockResolvedValue([]);

    const res = await request(app).get('/api/agents/feed');

    expect(res.status).toBe(200);
    expect(res.body.feed).toHaveLength(0);
  });
});

describe('GET /api/agents/leaderboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns top agents by earnings', async () => {
    mockAgentFindMany.mockResolvedValue([
      {
        id: 'agent-top',
        displayName: 'TopAgent',
        service: 'research',
        rating: 4.9,
        totalEarnings: 500.0,
        tasksCompleted: 100,
      },
      {
        id: 'agent-second',
        displayName: 'SecondAgent',
        service: 'scraping',
        rating: 4.7,
        totalEarnings: 250.0,
        tasksCompleted: 50,
      },
    ]);

    const res = await request(app).get('/api/agents/leaderboard');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.leaderboard).toHaveLength(2);
    expect(res.body.leaderboard[0].rank).toBe(1);
    expect(res.body.leaderboard[0].agentId).toBe('agent-top');
    expect(res.body.leaderboard[1].rank).toBe(2);
  });
});
