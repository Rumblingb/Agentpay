/**
 * Unit tests for moltbookService — reputation engine.
 * db.query is mocked so no live database is required.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
}));

import * as db from '../../src/db/index';
import {
  getBotReputation,
  getTopReputation,
  recordReputationEvent,
} from '../../src/services/moltbookService';

const mockQuery = db.query as jest.Mock;

const BOT_UUID = 'bbbbbbbb-0000-0000-0000-000000000002';

const BASE_BOT_ROW = {
  id: BOT_UUID,
  handle: 'test-bot',
  reputation_score: 72,
  total_transactions: 50,
  successful_transactions: 48,
  disputed_transactions: 1,
  tips_received_count: 5,
};

const SAMPLE_REP_EVENTS = [
  { event_type: 'payment_completed', impact: 2, description: 'Payment successful', created_at: new Date().toISOString() },
  { event_type: 'tip_received', impact: 1, description: 'Received a tip', created_at: new Date().toISOString() },
];

describe('moltbookService — reputation engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── getBotReputation ───────────────────────────────────────────────────

  describe('getBotReputation', () => {
    it('returns reputation data with recent events', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] })   // resolveBotId
        .mockResolvedValueOnce({ rows: [BASE_BOT_ROW] })        // bot row
        .mockResolvedValueOnce({ rows: SAMPLE_REP_EVENTS });    // rep events

      const rep = await getBotReputation(BOT_UUID);

      expect(rep).not.toBeNull();
      expect((rep as any).reputationScore).toBe(72);
      expect((rep as any).totalTransactions).toBe(50);
      expect((rep as any).successfulTransactions).toBe(48);
      expect((rep as any).recentEvents).toHaveLength(2);
    });

    it('returns null when bot not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // resolveBotId → not found
      const rep = await getBotReputation('nonexistent');
      expect(rep).toBeNull();
    });

    it('returns empty recent events when none exist', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] })
        .mockResolvedValueOnce({ rows: [BASE_BOT_ROW] })
        .mockResolvedValueOnce({ rows: [] });

      const rep = await getBotReputation(BOT_UUID);
      expect((rep as any).recentEvents).toHaveLength(0);
    });
  });

  // ── getTopReputation ───────────────────────────────────────────────────

  describe('getTopReputation', () => {
    it('returns top bots sorted by reputation', async () => {
      const topBots = [
        { ...BASE_BOT_ROW, id: 'bot-1', reputation_score: 95 },
        { ...BASE_BOT_ROW, id: 'bot-2', reputation_score: 88 },
        { ...BASE_BOT_ROW, id: 'bot-3', reputation_score: 72 },
      ];
      mockQuery.mockResolvedValueOnce({ rows: topBots });

      const result = await getTopReputation(10);

      expect(result).toHaveLength(3);
      // Verify LIMIT is passed
      const selectCall = mockQuery.mock.calls[0];
      expect(selectCall[1]).toContain(10);
    });

    it('uses default limit of 10', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await getTopReputation();
      const selectCall = mockQuery.mock.calls[0];
      expect(selectCall[1]).toContain(10);
    });

    it('returns empty list when no bots exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await getTopReputation();
      expect(result).toHaveLength(0);
    });
  });

  // ── recordReputationEvent ──────────────────────────────────────────────

  describe('recordReputationEvent', () => {
    it('inserts an event and updates the bot reputation score', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })  // INSERT reputation_events
        .mockResolvedValueOnce({ rows: [] }); // UPDATE bots.reputation_score

      await recordReputationEvent(BOT_UUID, 'payment_completed', 2, 'Payment successful');

      expect(mockQuery).toHaveBeenCalledTimes(2);

      // Check INSERT call
      const insertCall = mockQuery.mock.calls[0];
      expect(insertCall[0]).toContain('INSERT INTO reputation_events');
      expect(insertCall[1]).toContain(BOT_UUID);
      expect(insertCall[1]).toContain('payment_completed');
      expect(insertCall[1]).toContain(2);
      expect(insertCall[1]).toContain('Payment successful');

      // Check UPDATE call
      const updateCall = mockQuery.mock.calls[1];
      expect(updateCall[0]).toContain('UPDATE bots');
      expect(updateCall[1]).toContain(2);
      expect(updateCall[1]).toContain(BOT_UUID);
    });

    it('handles negative impact (penalty events)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await recordReputationEvent(BOT_UUID, 'payment_failed', -2, 'Insufficient balance');

      const insertCall = mockQuery.mock.calls[0];
      expect(insertCall[1]).toContain(-2);

      // The UPDATE uses GREATEST(0, LEAST(100, score + impact))
      const updateCall = mockQuery.mock.calls[1];
      expect(updateCall[1]).toContain(-2);
    });

    it('records event without description (optional)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await recordReputationEvent(BOT_UUID, 'tip_received', 1);

      const insertCall = mockQuery.mock.calls[0];
      expect(insertCall[1]).toContain(null); // description is null
    });
  });
});
