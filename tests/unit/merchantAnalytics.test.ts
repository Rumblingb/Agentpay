/**
 * Unit tests for merchantAnalytics service.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
}));

import * as db from '../../src/db/index';
import { getMerchantAnalytics } from '../../src/services/merchantAnalytics';

const mockQuery = db.query as jest.Mock;

const MERCHANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

describe('merchantAnalytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMerchantAnalytics', () => {
    it('returns analytics with all sections', async () => {
      // Revenue trends
      mockQuery.mockResolvedValueOnce({
        rows: [
          { date: '2026-02-28', revenue: '100.50', transaction_count: '5' },
          { date: '2026-03-01', revenue: '200.00', transaction_count: '10' },
        ],
      });

      // Top agents
      mockQuery.mockResolvedValueOnce({
        rows: [
          { agent_id: 'agent-001', total_spent: '150.00', transaction_count: '8', last_active: new Date().toISOString() },
        ],
      });

      // Churn risks
      mockQuery.mockResolvedValueOnce({
        rows: [
          { agent_id: 'agent-old', last_active: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(), days_inactive: '20' },
        ],
      });

      // Moltbook stats
      mockQuery.mockResolvedValueOnce({
        rows: [{
          agentic_revenue: '180.00',
          direct_revenue: '120.50',
          agentic_count: '12',
          direct_count: '3',
        }],
      });

      const analytics = await getMerchantAnalytics(MERCHANT_ID, 30);

      // Revenue trends
      expect(analytics.revenueTrends).toHaveLength(2);
      expect(analytics.revenueTrends[0].revenue).toBe(100.5);
      expect(analytics.revenueTrends[1].transactionCount).toBe(10);

      // Top agents
      expect(analytics.topAgents).toHaveLength(1);
      expect(analytics.topAgents[0].agentId).toBe('agent-001');
      expect(analytics.topAgents[0].totalSpent).toBe(150);

      // Churn risks
      expect(analytics.churnRisks).toHaveLength(1);
      expect(analytics.churnRisks[0].riskLevel).toBe('medium'); // 20 days > 14

      // Moltbook stats
      expect(analytics.moltbookStats.agenticRevenue).toBe(180);
      expect(analytics.moltbookStats.directApiRevenue).toBe(120.5);

      // Summary
      expect(analytics.summary.totalRevenue).toBeCloseTo(300.5);
      expect(analytics.summary.totalTransactions).toBe(15);
      expect(analytics.summary.activeAgents).toBe(1);
      expect(analytics.summary.periodDays).toBe(30);
    });

    it('returns empty analytics when queries return no data', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })  // trends
        .mockResolvedValueOnce({ rows: [] })  // top agents
        .mockResolvedValueOnce({ rows: [] })  // churn
        .mockResolvedValueOnce({ rows: [{}] }); // moltbook (empty row)

      const analytics = await getMerchantAnalytics(MERCHANT_ID);

      expect(analytics.revenueTrends).toHaveLength(0);
      expect(analytics.topAgents).toHaveLength(0);
      expect(analytics.churnRisks).toHaveLength(0);
      expect(analytics.summary.totalRevenue).toBe(0);
    });

    it('handles query failures gracefully', async () => {
      mockQuery
        .mockRejectedValueOnce(new Error('DB error'))  // trends fail
        .mockRejectedValueOnce(new Error('DB error'))  // agents fail
        .mockRejectedValueOnce(new Error('DB error'))  // churn fail
        .mockRejectedValueOnce(new Error('DB error')); // moltbook fail

      const analytics = await getMerchantAnalytics(MERCHANT_ID);

      // Should return empty defaults without throwing
      expect(analytics.revenueTrends).toHaveLength(0);
      expect(analytics.topAgents).toHaveLength(0);
      expect(analytics.summary.totalRevenue).toBe(0);
    });
  });
});
