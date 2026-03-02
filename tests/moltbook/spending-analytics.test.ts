/**
 * Unit tests for moltbookService — spending analytics, deep analytics,
 * demo simulation, and pause/resume controls.
 * db.query is mocked so no live database is required.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
}));

import * as db from '../../src/db/index';
import {
  getBotSpending,
  getBotAnalytics,
  simulatePayment,
  pauseBot,
  resumeBot,
  getMarketplaceServices,
} from '../../src/services/moltbookService';

const mockQuery = db.query as jest.Mock;

const BOT_UUID = 'aaaaaaaa-0000-0000-0000-000000000001';

describe('moltbookService — spending analytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── getBotSpending ──────────────────────────────────────────────────────

  describe('getBotSpending', () => {
    it('returns null when bot not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // resolveBotByHandle
      const result = await getBotSpending('nonexistent');
      expect(result).toBeNull();
    });

    it('returns spending analytics for a valid bot', async () => {
      // resolveBotByHandle
      mockQuery.mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] });
      // botRow (policy)
      mockQuery.mockResolvedValueOnce({
        rows: [{ daily_spending_limit: '100.00', per_tx_limit: '10.00', auto_approve_under: '2.00' }],
      });
      // today spend
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '45.50' }] });
      // today tx count
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '12' }] });
      // last 7 days
      mockQuery.mockResolvedValueOnce({
        rows: [
          { date: '2026-02-24', amount: '10.00' },
          { date: '2026-02-25', amount: '15.00' },
        ],
      });
      // top merchants
      mockQuery.mockResolvedValueOnce({
        rows: [
          { name: 'OpenAI API', total_spent: '30.00', transaction_count: '8' },
          { name: 'Pinecone', total_spent: '15.50', transaction_count: '4' },
        ],
      });
      // recent tx
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'tx1', merchant_name: 'OpenAI API', amount: '2.50', status: 'completed' }],
      });

      const result = await getBotSpending('@TestBot');
      expect(result).not.toBeNull();
      expect(result!.today.spent).toBe(45.5);
      expect(result!.today.limit).toBe(100);
      expect(result!.today.percentUsed).toBeCloseTo(45.5);
      expect(result!.today.transactions).toBe(12);
      expect(result!.last7Days).toHaveLength(2);
      expect(result!.topMerchants).toHaveLength(2);
      expect(result!.topMerchants[0].name).toBe('OpenAI API');
      expect(result!.policy.dailyLimit).toBe(100);
      expect(result!.recentTransactions).toHaveLength(1);
    });

    it('generates warning alert when above 70% usage', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ daily_spending_limit: '100.00', per_tx_limit: '10.00', auto_approve_under: '2.00' }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '75.00' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '20' }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getBotSpending('@TestBot');
      expect(result!.alerts).toHaveLength(1);
      expect(result!.alerts[0].type).toBe('warning');
    });

    it('generates error alert when above 90% usage', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ daily_spending_limit: '100.00', per_tx_limit: '10.00', auto_approve_under: '2.00' }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '95.00' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '30' }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getBotSpending('@TestBot');
      expect(result!.alerts).toHaveLength(1);
      expect(result!.alerts[0].type).toBe('error');
    });
  });

  // ── getBotAnalytics ──────────────────────────────────────────────────────

  describe('getBotAnalytics', () => {
    it('returns null when bot not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await getBotAnalytics('nonexistent');
      expect(result).toBeNull();
    });

    it('returns deep analytics for a valid bot', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] });
      // lifetime stats
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: '500.00', avg_amount: '2.50', total_count: '200' }],
      });
      // success rate
      mockQuery.mockResolvedValueOnce({
        rows: [{ success: '190', total: '200' }],
      });
      // merchant diversity
      mockQuery.mockResolvedValueOnce({ rows: [{ diversity: '8' }] });
      // velocity
      mockQuery.mockResolvedValueOnce({
        rows: [
          { date: '2026-02-25', amount: '20.00' },
          { date: '2026-02-26', amount: '25.00' },
        ],
      });
      // hourly
      mockQuery.mockResolvedValueOnce({
        rows: [
          { hour: '14', count: '30' },
          { hour: '10', count: '25' },
        ],
      });

      const result = await getBotAnalytics('@TestBot');
      expect(result).not.toBeNull();
      expect(result!.lifetimeSpending).toBe(500);
      expect(result!.averageTransactionSize).toBe(2.5);
      expect(result!.totalTransactions).toBe(200);
      expect(result!.successRate).toBe(95);
      expect(result!.merchantDiversity).toBe(8);
      expect(result!.spendingVelocity).toHaveLength(2);
      expect(result!.mostActiveHours).toHaveLength(2);
      expect(result!.costPerAction).toBe(2.5);
    });
  });

  // ── simulatePayment ──────────────────────────────────────────────────────

  describe('simulatePayment', () => {
    it('returns null when bot not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await simulatePayment('nonexistent');
      expect(result).toBeNull();
    });

    it('creates a simulated transaction', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'tx-123', from_bot_id: BOT_UUID, merchant_name: 'OpenAI API', amount: '2.50', status: 'completed' }],
      });
      // recordReputationEvent calls
      mockQuery.mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] }); // resolveBotId
      mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT reputation

      const result = await simulatePayment('@TestBot', 'OpenAI API', 2.5);
      expect(result).not.toBeNull();
      expect(result!.merchant_name).toBe('OpenAI API');
    });
  });

  // ── pauseBot / resumeBot ─────────────────────────────────────────────────

  describe('pauseBot', () => {
    it('returns false when bot not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      expect(await pauseBot('nonexistent')).toBe(false);
    });

    it('pauses a bot successfully', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] });
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      expect(await pauseBot('@TestBot')).toBe(true);
    });

    it('returns false when bot already paused', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] });
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      expect(await pauseBot('@TestBot')).toBe(false);
    });
  });

  describe('resumeBot', () => {
    it('returns false when bot not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      expect(await resumeBot('nonexistent')).toBe(false);
    });

    it('resumes a paused bot successfully', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] });
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      expect(await resumeBot('@TestBot')).toBe(true);
    });
  });

  // ── getMarketplaceServices ───────────────────────────────────────────────

  describe('getMarketplaceServices', () => {
    it('returns services with no filters', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 's1', name: 'OpenAI', price_usdc: '0.01', rating: '4.5' }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] });

      const result = await getMarketplaceServices();
      expect(result.services).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('applies service type filter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });

      const result = await getMarketplaceServices({ serviceType: 'inference' });
      expect(result.services).toHaveLength(0);

      // Check that the query included the category filter
      const firstCall = mockQuery.mock.calls[0];
      expect(firstCall[0]).toContain('category');
      expect(firstCall[1]).toContain('inference');
    });
  });
});
