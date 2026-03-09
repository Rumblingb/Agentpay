/**
 * Unit tests for agentrankService — score adjustment with clamping, history,
 * grade calculation, and graceful DB-unavailable handling.
 * Prisma is mocked.
 */

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    agentrank_scores: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import prisma from '../../src/lib/prisma';
import { adjustScore, getScoreHistory } from '../../src/services/agentrankService';

const mockFindUnique = prisma.agentrank_scores.findUnique as jest.Mock;
const mockCreate = prisma.agentrank_scores.create as jest.Mock;
const mockUpdate = prisma.agentrank_scores.update as jest.Mock;

const AGENT_ID = 'agent-rank-test-001';

describe('agentrankService', () => {
  beforeEach(() => jest.clearAllMocks());

  // ---------- adjustScore ----------
  describe('adjustScore', () => {
    it('creates a new record when agent has no existing score', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      mockCreate.mockResolvedValueOnce({ agent_id: AGENT_ID, score: 10, grade: 'D' });

      const result = await adjustScore(AGENT_ID, 10, 'escrow_approve');

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(result?.score).toBe(10);
    });

    it('updates an existing record', async () => {
      mockFindUnique.mockResolvedValueOnce({ agent_id: AGENT_ID, score: 500, grade: 'B', history: [] });
      mockUpdate.mockResolvedValueOnce({ agent_id: AGENT_ID, score: 510, grade: 'B' });

      const result = await adjustScore(AGENT_ID, 10, 'escrow_approve');

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(result?.score).toBe(510);
    });

    it('clamps score to MAX 1000', async () => {
      mockFindUnique.mockResolvedValueOnce({ agent_id: AGENT_ID, score: 995, grade: 'S', history: [] });
      mockUpdate.mockResolvedValueOnce({});

      const result = await adjustScore(AGENT_ID, 100, 'bonus');

      expect(result?.score).toBe(1000); // clamped
    });

    it('clamps score to MIN 0', async () => {
      mockFindUnique.mockResolvedValueOnce({ agent_id: AGENT_ID, score: 5, grade: 'D', history: [] });
      mockUpdate.mockResolvedValueOnce({});

      const result = await adjustScore(AGENT_ID, -100, 'dispute');

      expect(result?.score).toBe(0); // clamped
    });

    it('returns correct grade S for score >= 950', async () => {
      mockFindUnique.mockResolvedValueOnce({ agent_id: AGENT_ID, score: 940, grade: 'A', history: [] });
      mockUpdate.mockResolvedValueOnce({});

      const result = await adjustScore(AGENT_ID, 15, 'bonus');
      expect(result?.grade).toBe('S'); // 940 + 15 = 955 >= 950
    });

    it('returns grade A for score 800–949', async () => {
      mockFindUnique.mockResolvedValueOnce({ agent_id: AGENT_ID, score: 790, grade: 'B', history: [] });
      mockUpdate.mockResolvedValueOnce({});

      const result = await adjustScore(AGENT_ID, 15, 'bonus');
      expect(result?.grade).toBe('A'); // 790 + 15 = 805 >= 800
    });

    it('returns grade B for score >= 600', async () => {
      mockFindUnique.mockResolvedValueOnce({ agent_id: AGENT_ID, score: 595, grade: 'C', history: [] });
      mockUpdate.mockResolvedValueOnce({});

      const result = await adjustScore(AGENT_ID, 10, 'bonus');
      expect(result?.grade).toBe('B'); // 595 + 10 = 605 >= 600
    });

    it('returns grade C for score >= 400', async () => {
      mockFindUnique.mockResolvedValueOnce({ agent_id: AGENT_ID, score: 395, grade: 'D', history: [] });
      mockUpdate.mockResolvedValueOnce({});

      const result = await adjustScore(AGENT_ID, 10, 'bonus');
      expect(result?.grade).toBe('C'); // 395 + 10 = 405 >= 400
    });

    it('includes event in history entry', async () => {
      mockFindUnique.mockResolvedValueOnce({ agent_id: AGENT_ID, score: 100, grade: 'D', history: [] });
      mockUpdate.mockResolvedValueOnce({});

      await adjustScore(AGENT_ID, 5, 'payment_verification', 'Payment verified');

      const updateCall = mockUpdate.mock.calls[0][0];
      const history = updateCall.data.history;
      expect(history[history.length - 1].reason).toContain('payment_verification');
    });

    it('trims history to last 100 entries', async () => {
      const existingHistory = Array.from({ length: 100 }, (_, i) => ({
        score: i,
        timestamp: new Date().toISOString(),
        reason: `event-${i}`,
      }));
      mockFindUnique.mockResolvedValueOnce({
        agent_id: AGENT_ID,
        score: 500,
        grade: 'B',
        history: existingHistory,
      });
      mockUpdate.mockResolvedValueOnce({});

      await adjustScore(AGENT_ID, 10, 'new_event');

      const updateCall = mockUpdate.mock.calls[0][0];
      const history = updateCall.data.history;
      expect(history.length).toBe(100); // stays at cap
      expect(history[history.length - 1].reason).toBe('new_event');
    });

    it('returns null gracefully when DB is unavailable (table missing)', async () => {
      const err: any = new Error('relation "agentrank_scores" does not exist');
      err.code = 'P2021';
      mockFindUnique.mockRejectedValueOnce(err);

      const result = await adjustScore(AGENT_ID, 10, 'test_event');
      expect(result).toBeNull();
    });

    it('returns null gracefully for general DB errors', async () => {
      mockFindUnique.mockRejectedValueOnce(new Error('connection refused'));
      const result = await adjustScore(AGENT_ID, 10, 'test_event');
      expect(result).toBeNull();
    });
  });

  // ---------- getScoreHistory ----------
  describe('getScoreHistory', () => {
    it('returns null when agent has no record', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      const result = await getScoreHistory(AGENT_ID);
      expect(result).toBeNull();
    });

    it('returns score, grade, and history array', async () => {
      const history = [
        { score: 50, timestamp: '2024-01-01T00:00:00.000Z', reason: 'initial' },
        { score: 60, timestamp: '2024-01-02T00:00:00.000Z', reason: 'bonus' },
      ];
      mockFindUnique.mockResolvedValueOnce({
        agent_id: AGENT_ID,
        score: 60,
        grade: 'D',
        history,
      });

      const result = await getScoreHistory(AGENT_ID);
      expect(result?.score).toBe(60);
      expect(result?.grade).toBe('D');
      expect(result?.history).toHaveLength(2);
    });

    it('returns empty array when history field is not an array', async () => {
      mockFindUnique.mockResolvedValueOnce({
        agent_id: AGENT_ID,
        score: 0,
        grade: 'U',
        history: null,
      });
      const result = await getScoreHistory(AGENT_ID);
      expect(result?.history).toEqual([]);
    });

    it('returns null on DB error', async () => {
      mockFindUnique.mockRejectedValueOnce(new Error('timeout'));
      const result = await getScoreHistory(AGENT_ID);
      expect(result).toBeNull();
    });
  });
});
