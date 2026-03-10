/**
 * Unit tests for reconciliationService.
 * Prisma and raw DB are mocked; no real database needed.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  pool: { on: jest.fn() },
  closePool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    paymentIntent: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    agentTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    agentEscrow: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  },
}));

import prisma from '../../src/lib/prisma';
import { query } from '../../src/db/index';
import { runReconciliation, getLastReport } from '../../src/services/reconciliationService';

const mockPaymentIntentFindMany = prisma.paymentIntent.findMany as jest.Mock;
const mockPaymentIntentCount   = prisma.paymentIntent.count   as jest.Mock;
const mockAgentTxFindMany      = (prisma as any).agentTransaction.findMany as jest.Mock;
const mockAgentEscrowFindMany  = (prisma as any).agentEscrow.findMany     as jest.Mock;
const mockDbQuery              = query as jest.Mock;

describe('reconciliationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset default resolutions
    mockPaymentIntentFindMany.mockResolvedValue([]);
    mockPaymentIntentCount.mockResolvedValue(0);
    mockAgentTxFindMany.mockResolvedValue([]);
    mockAgentEscrowFindMany.mockResolvedValue([]);
    mockDbQuery.mockResolvedValue({ rows: [] });
  });

  describe('getLastReport', () => {
    it('returns a report after a run (not null)', async () => {
      await runReconciliation();
      const report = getLastReport();
      expect(report).not.toBeNull();
    });
  });

  describe('runReconciliation', () => {
    it('returns a report with the correct shape', async () => {
      const report = await runReconciliation();

      expect(report).toMatchObject({
        runId: expect.stringMatching(/^rcn_/),
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
        durationMs: expect.any(Number),
        anomalies: expect.any(Array),
        stats: {
          paymentIntentsChecked: expect.any(Number),
          transactionsChecked: expect.any(Number),
          agentTransactionsChecked: expect.any(Number),
          agentEscrowsChecked: expect.any(Number),
          anomaliesFound: expect.any(Number),
          criticalAnomalies: expect.any(Number),
        },
      });
    });

    it('returns zero anomalies when all mocks return empty data', async () => {
      const report = await runReconciliation();
      expect(report.anomalies).toHaveLength(0);
      expect(report.stats.anomaliesFound).toBe(0);
    });

    it('detects stale pending intents when mock returns stale data', async () => {
      const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      mockPaymentIntentFindMany.mockResolvedValue([
        { id: 'pi_stale_1', merchantId: 'merch-1', amount: 50, createdAt: staleDate },
        { id: 'pi_stale_2', merchantId: 'merch-2', amount: 25, createdAt: staleDate },
      ]);

      const report = await runReconciliation();

      const staleAnomalies = report.anomalies.filter((a) => a.type === 'STALE_PENDING');
      expect(staleAnomalies).toHaveLength(2);
      expect(report.stats.anomaliesFound).toBe(2);
    });

    it('counts critical anomalies correctly', async () => {
      const staleDate = new Date(Date.now() - 200 * 60 * 60 * 1000); // very old
      mockAgentEscrowFindMany.mockResolvedValue([
        { id: 'esc_1', transactionId: 'tx_1', amount: 100, createdAt: staleDate },
      ]);

      const report = await runReconciliation();

      const timeoutAnomalies = report.anomalies.filter((a) => a.type === 'ESCROW_TIMEOUT');
      expect(timeoutAnomalies).toHaveLength(1);
      expect(timeoutAnomalies[0].severity).toBe('critical');
      expect(report.stats.criticalAnomalies).toBeGreaterThanOrEqual(1);
    });

    it('report durationMs is non-negative', async () => {
      const report = await runReconciliation();
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
