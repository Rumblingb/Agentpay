/**
 * Tests for the AgentRank API route — verifies DB lookup from agentrank_scores,
 * handle/pubkey acceptance, and fallback behaviour.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// --- Prisma mock --------------------------------------------------------
const mockFindUnique = jest.fn();
const mockFindMany = jest.fn();

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    agentrank_scores: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
    },
  },
}));

// --- DB query mock (for bots table fallback) -----------------------------
const mockDbQuery = jest.fn();
jest.mock('../src/db/index', () => ({
  __esModule: true,
  query: (...args: any[]) => mockDbQuery(...args),
  pool: { on: jest.fn() },
  closePool: jest.fn(),
}));

import request from 'supertest';
import express from 'express';

// Import the router *after* mocks are set up
import agentrankRouter from '../src/routes/agentrank';

const app = express();
app.use(express.json());
app.use('/api/agentrank', agentrankRouter);

// Demo wallet fixture (matches seed-demo-wallets.ts)
const DEMO_SLASH_RECORD = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  agent_id: 'DemoAgentSlash150',
  score: 150,
  grade: 'F',
  payment_reliability: 0.20,
  service_delivery: 0.10,
  transaction_volume: 45,
  wallet_age_days: 30,
  dispute_rate: 0.60,
  stake_usdc: 10.0,
  unique_counterparties: 2,
  factors: {},
  history: [],
  created_at: new Date(),
  updated_at: new Date(),
};

describe('AgentRank API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindUnique.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([]);
    mockDbQuery.mockResolvedValue({ rows: [] });
  });

  // --- Validation ---------------------------------------------------------
  it('rejects empty agentId', async () => {
    const res = await request(app).get('/api/agentrank/%20');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid agentId');
  });

  // --- DB lookup (exact match) -------------------------------------------
  it('returns stored score for exact agent_id match', async () => {
    mockFindUnique.mockResolvedValueOnce(DEMO_SLASH_RECORD);

    const res = await request(app).get('/api/agentrank/DemoAgentSlash150');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const ar = res.body.agentRank;
    expect(ar.agentId).toBe('DemoAgentSlash150');
    expect(ar.score).toBe(150);
    expect(ar.grade).toBe('F');
    expect(ar.factors.paymentReliability).toBeCloseTo(0.20);
    expect(ar.factors.disputeRate).toBeCloseTo(0.60);
  });

  // --- Case-insensitive lookup -------------------------------------------
  it('returns stored score for case-insensitive agent_id match', async () => {
    // findUnique returns null (exact miss), but findMany returns the record
    mockFindUnique.mockResolvedValue(null);
    mockFindMany.mockResolvedValueOnce([DEMO_SLASH_RECORD]);

    const res = await request(app).get('/api/agentrank/demoagentslash150');

    expect(res.status).toBe(200);
    expect(res.body.agentRank.score).toBe(150);
    expect(res.body.agentRank.grade).toBe('F');
  });

  // --- Bots table fallback -----------------------------------------------
  it('falls back to bots table when agentrank_scores has no match', async () => {
    // agentrank_scores: no match
    mockFindUnique.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([]);

    // bots table returns a bot with handle matching the input
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'bot-uuid', handle: 'DemoAgentSlash150', wallet_address: 'wallet123', platform_bot_id: 'plat-1' }],
    });

    // Second findUnique call (via findAgentRankScore for bot.handle) finds the record
    mockFindUnique
      .mockResolvedValueOnce(null) // first call in findAgentRankScore for identifier
      .mockResolvedValueOnce(DEMO_SLASH_RECORD); // call for bot.handle

    const res = await request(app).get('/api/agentrank/DemoAgentSlash150');

    expect(res.status).toBe(200);
    expect(res.body.agentRank.score).toBe(150);
  });

  // --- Unknown agent returns computed default ----------------------------
  it('returns default score for unknown agent', async () => {
    const res = await request(app).get('/api/agentrank/unknownAgent');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Zero factors still yield a small score from the inverse dispute-rate
    // component (5% weight), minus Sybil penalties (30%).
    expect(res.body.agentRank.score).toBe(35);
    expect(res.body.agentRank.grade).toBe('F');
  });

  // --- Accepts pubkey-style input ----------------------------------------
  it('accepts pubkey-style input and looks up by agent_id', async () => {
    const pubkey = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
    const record = { ...DEMO_SLASH_RECORD, agent_id: pubkey, score: 800, grade: 'A' };
    mockFindUnique.mockResolvedValueOnce(record);

    const res = await request(app).get(`/api/agentrank/${pubkey}`);

    expect(res.status).toBe(200);
    expect(res.body.agentRank.agentId).toBe(pubkey);
    expect(res.body.agentRank.score).toBe(800);
  });

  // --- Graceful handling when bots table does not exist -------------------
  it('handles missing bots table gracefully', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('relation "bots" does not exist'));

    const res = await request(app).get('/api/agentrank/nonexistent');

    expect(res.status).toBe(200);
    expect(res.body.agentRank.score).toBe(35);
    expect(res.body.agentRank.grade).toBe('F');
  });

  // --- Graceful handling when agentrank_scores table does not exist ------
  it('handles missing agentrank_scores table gracefully', async () => {
    const tableError = new Error(
      'The table `public.agentrank_scores` does not exist in the current database.',
    );
    mockFindUnique.mockRejectedValue(tableError);
    mockFindMany.mockRejectedValue(tableError);

    const res = await request(app).get('/api/agentrank/DemoAgentNew300');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.agentRank.agentId).toBe('DemoAgentNew300');
    expect(res.body.agentRank.score).toBe(35);
    expect(res.body.agentRank.grade).toBe('F');
  });
});
