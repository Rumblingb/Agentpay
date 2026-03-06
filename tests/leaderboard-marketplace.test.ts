/**
 * Tests for the new AgentRank leaderboard and Marketplace discovery endpoints.
 *
 * GET /api/agentrank/leaderboard
 * GET /api/marketplace/discover
 * GET /api/marketplace/featured
 * GET /api/marketplace/categories
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// --- Prisma mock -----------------------------------------------------------------
const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();
const mockCount = jest.fn();

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    agentrank_scores: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
      count: (...args: any[]) => mockCount(...args),
    },
  },
}));

// --- DB mock (for bots table enrichment) ----------------------------------------
const mockDbQuery = jest.fn();
jest.mock('../src/db/index', () => ({
  __esModule: true,
  query: (...args: any[]) => mockDbQuery(...args),
  pool: { on: jest.fn() },
  closePool: jest.fn(),
}));

import request from 'supertest';
import express from 'express';
import agentrankRouter from '../src/routes/agentrank';
import marketplaceRouter from '../src/routes/marketplace';

const app = express();
app.use(express.json());
app.use('/api/agentrank', agentrankRouter);
app.use('/api/marketplace', marketplaceRouter);

// Sample records
const AGENT_A = {
  id: 'uuid-a',
  agent_id: 'agent-alpha',
  score: 900,
  grade: 'S',
  payment_reliability: 0.98,
  service_delivery: 0.95,
  transaction_volume: 500,
  wallet_age_days: 365,
  dispute_rate: 0.01,
  stake_usdc: 500,
  unique_counterparties: 50,
  updated_at: new Date('2026-01-01'),
};

const AGENT_B = {
  id: 'uuid-b',
  agent_id: 'agent-beta',
  score: 750,
  grade: 'A',
  payment_reliability: 0.90,
  service_delivery: 0.85,
  transaction_volume: 200,
  wallet_age_days: 180,
  dispute_rate: 0.05,
  stake_usdc: 100,
  unique_counterparties: 20,
  updated_at: new Date('2026-01-15'),
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: bots table lookup returns empty
  mockDbQuery.mockResolvedValue({ rows: [] });
});

// ============================================================
// AgentRank Leaderboard
// ============================================================
describe('GET /api/agentrank/leaderboard', () => {
  it('returns a sorted leaderboard with pagination', async () => {
    mockFindMany.mockResolvedValue([AGENT_A, AGENT_B]);
    mockCount.mockResolvedValue(2);

    const res = await request(app).get('/api/agentrank/leaderboard');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.leaderboard).toHaveLength(2);
    expect(res.body.leaderboard[0].agentId).toBe('agent-alpha');
    expect(res.body.leaderboard[0].score).toBe(900);
    expect(res.body.leaderboard[0].rank).toBe(1);
    expect(res.body.leaderboard[1].rank).toBe(2);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.pagination.hasMore).toBe(false);
  });

  it('respects limit and offset query params', async () => {
    mockFindMany.mockResolvedValue([AGENT_B]);
    mockCount.mockResolvedValue(5);

    const res = await request(app).get('/api/agentrank/leaderboard?limit=1&offset=1');

    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toHaveLength(1);
    expect(res.body.leaderboard[0].rank).toBe(2); // offset + idx + 1 = 1 + 0 + 1 = 2
    expect(res.body.pagination.offset).toBe(1);
    expect(res.body.pagination.limit).toBe(1);
    expect(res.body.pagination.hasMore).toBe(true); // 1 + 1 < 5
  });

  it('filters by tier when provided', async () => {
    mockFindMany.mockResolvedValue([AGENT_A]);
    mockCount.mockResolvedValue(1);

    const res = await request(app).get('/api/agentrank/leaderboard?tier=S');

    expect(res.status).toBe(200);
    // Verify findMany was called with grade filter
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ grade: 'S' }),
      }),
    );
  });

  it('returns 400 for invalid tier', async () => {
    const res = await request(app).get('/api/agentrank/leaderboard?tier=X');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid tier/i);
  });

  it('returns empty leaderboard when DB table does not exist', async () => {
    const tableError = Object.assign(new Error('does not exist'), { code: 'P2021' });
    mockFindMany.mockRejectedValue(tableError);
    mockCount.mockRejectedValue(tableError);

    const res = await request(app).get('/api/agentrank/leaderboard');

    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('limits maximum results to 100', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await request(app).get('/api/agentrank/leaderboard?limit=999');
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it('includes breakdown fields in each leaderboard entry', async () => {
    mockFindMany.mockResolvedValue([AGENT_A]);
    mockCount.mockResolvedValue(1);

    const res = await request(app).get('/api/agentrank/leaderboard');
    const entry = res.body.leaderboard[0];

    expect(entry).toHaveProperty('paymentReliability');
    expect(entry).toHaveProperty('serviceDelivery');
    expect(entry).toHaveProperty('transactionVolume');
    expect(entry).toHaveProperty('walletAgeDays');
    expect(entry).toHaveProperty('disputeRate');
  });
});

// ============================================================
// Marketplace Discovery
// ============================================================
describe('GET /api/marketplace/discover', () => {
  it('returns agents with enrichment fields', async () => {
    mockFindMany.mockResolvedValue([AGENT_A, AGENT_B]);
    mockCount.mockResolvedValue(2);

    const res = await request(app).get('/api/marketplace/discover');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.agents).toHaveLength(2);
    expect(res.body.agents[0]).toHaveProperty('agentId');
    expect(res.body.agents[0]).toHaveProperty('score');
    expect(res.body.agents[0]).toHaveProperty('grade');
    expect(res.body.agents[0]).toHaveProperty('profileUrl');
    expect(res.body.pagination).toBeDefined();
  });

  it('filters agents by text query (q)', async () => {
    mockFindMany.mockResolvedValue([AGENT_A, AGENT_B]);
    mockCount.mockResolvedValue(2);

    const res = await request(app).get('/api/marketplace/discover?q=alpha');

    expect(res.status).toBe(200);
    expect(res.body.agents).toHaveLength(1);
    expect(res.body.agents[0].agentId).toBe('agent-alpha');
  });

  it('returns 400 for invalid sortBy', async () => {
    const res = await request(app).get('/api/marketplace/discover?sortBy=invalid');
    expect(res.status).toBe(400);
  });

  it('handles missing agentrank_scores table gracefully', async () => {
    const tableError = Object.assign(new Error('does not exist'), { code: 'P2021' });
    mockFindMany.mockRejectedValue(tableError);
    mockCount.mockRejectedValue(tableError);

    const res = await request(app).get('/api/marketplace/discover');
    expect(res.status).toBe(200);
    expect(res.body.agents).toEqual([]);
  });

  it('respects limit query param', async () => {
    mockFindMany.mockResolvedValue([AGENT_A]);
    mockCount.mockResolvedValue(10);

    await request(app).get('/api/marketplace/discover?limit=1');
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1 }),
    );
  });
});

// ============================================================
// Marketplace Featured
// ============================================================
describe('GET /api/marketplace/featured', () => {
  it('returns featured agents', async () => {
    mockFindMany.mockResolvedValue([AGENT_A]);

    const res = await request(app).get('/api/marketplace/featured');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.featured).toHaveLength(1);
    expect(res.body.featured[0]).toHaveProperty('badge');
    expect(res.body.featured[0].badge).toBe('elite'); // score 900 >= 900
  });

  it('returns empty featured when no high-ranked agents', async () => {
    mockFindMany.mockResolvedValue([]);

    const res = await request(app).get('/api/marketplace/featured');
    expect(res.status).toBe(200);
    expect(res.body.featured).toEqual([]);
  });

  it('handles missing table gracefully', async () => {
    mockFindMany.mockRejectedValue(new Error('does not exist'));

    const res = await request(app).get('/api/marketplace/featured');
    expect(res.status).toBe(200);
    expect(res.body.featured).toEqual([]);
  });
});

// ============================================================
// Marketplace Categories
// ============================================================
describe('GET /api/marketplace/categories', () => {
  it('returns the categories list', async () => {
    const res = await request(app).get('/api/marketplace/categories');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(res.body.categories.length).toBeGreaterThan(0);
    expect(res.body.categories[0]).toHaveProperty('id');
    expect(res.body.categories[0]).toHaveProperty('name');
    expect(res.body.categories[0]).toHaveProperty('description');
    expect(res.body.total).toBe(res.body.categories.length);
  });
});
