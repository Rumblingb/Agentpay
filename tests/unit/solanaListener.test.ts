/**
 * Unit tests for Phase 9 Solana listener settlement integration.
 *
 * Validates that processIntent():
 *   1. Emits a `hash_submitted` settlement event on every poll
 *   2. Calls ingestSolanaProof() after on-chain confirmation
 *   3. Calls runResolutionEngine() with correct params
 *   4. Continues to the legacy prisma.$transaction even when engine fails
 *   5. Extended query selects verificationToken + externalRef
 *
 * All external I/O is mocked — no real DB or RPC needed.
 */

// ── Mocks (must come before any imports) ────────────────────────────────────

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  pool: { on: jest.fn() },
  closePool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    merchant: { findUnique: jest.fn() },
    paymentIntent: { updateMany: jest.fn() },
    transactions: { create: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([{ count: 1 }, {}]),
  },
}));

jest.mock('../../src/security/payment-verification', () => ({
  verifyPaymentRecipient: jest.fn(),
}));

jest.mock('../../src/services/webhooks', () => ({
  scheduleWebhook: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/settlement/settlementEventIngestion', () => ({
  ingestSolanaProof: jest.fn().mockReturnValue('mock-event-id-001'),
  normalizeSolanaObservation: jest.requireActual(
    '../../src/settlement/settlementEventIngestion',
  ).normalizeSolanaObservation,
}));

jest.mock('../../src/settlement/settlementEventService', () => ({
  emitSettlementEvent: jest.fn().mockReturnValue('mock-hash-submitted-event'),
}));

jest.mock('../../src/settlement/intentResolutionEngine', () => ({
  runResolutionEngine: jest.fn(),
}));

// Mock logger to avoid bringing in runtime pino dependency in tests
jest.mock('../../src/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

// Provide aliases to commonly-checked mocks
const mockScheduleWebhook = (require('../../src/services/webhooks') as any).scheduleWebhook as jest.Mock;
const mockPrismaPaymentIntentUpdateMany = (require('../../src/lib/prisma') as any).default.paymentIntent.updateMany as jest.Mock;
// Mock revenue controller if invoked by downstream flows (should not be invoked on duplicate)
jest.mock('../../src/controllers/revenueController', () => ({
  RevenueController: { processOnChainVerification: jest.fn() },
}));
const mockRevenueProcess = (require('../../src/controllers/revenueController') as any).RevenueController.processOnChainVerification as jest.Mock;

// ── Imports ──────────────────────────────────────────────────────────────────

import { startSolanaListener, stopSolanaListener } from '../../src/services/solana-listener';
import { query } from '../../src/db/index';
import prisma from '../../src/lib/prisma';
import { verifyPaymentRecipient } from '../../src/security/payment-verification';
import { ingestSolanaProof } from '../../src/settlement/settlementEventIngestion';
import { emitSettlementEvent } from '../../src/settlement/settlementEventService';
import { runResolutionEngine } from '../../src/settlement/intentResolutionEngine';

const mockQuery = query as jest.Mock;
const mockVerify = verifyPaymentRecipient as jest.Mock;
const mockIngestSolana = ingestSolanaProof as jest.Mock;
const mockEmitSettlementEvent = emitSettlementEvent as jest.Mock;
const mockRunEngine = runResolutionEngine as jest.Mock;
const mockPrismaTransaction = (prisma as any).$transaction as jest.Mock;
const mockPrismaTransactionsCreate = (prisma as any).transactions.create as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal confirmed verification result */
const CONFIRMED_VERIFICATION = {
  valid: true,
  verified: true,
  payer: 'PayerWallet111111111111111111111111111111111',
  confirmationDepth: 3,
};

/** Mock row returned by fetchPendingIntentsWithHash */
const PENDING_INTENT_ROW = {
  intentId: 'intent-uuid-phase9-001',
  merchantId: 'merchant-uuid-001',
  amountUsdc: 10.0,
  recipientAddress: 'MerchantWallet111111111111111111111111111111',
  txHash: '5TxHash111111111111111111111111111111111111111',
  verificationToken: 'vt-abc-123',
  externalRef: null,
  metadata: { some: 'meta' },
  webhookUrl: null,
};

/** Build the multi-call query mock sequence for one poll cycle */
function setupQueryMocks(intents: object[] = [PENDING_INTENT_ROW]) {
  // call 1: expireStaleTransactions → UPDATE
  // call 2: fetchPendingWithHash → returns []
  // call 3: fetchPendingIntentsWithHash → returns intents
  mockQuery
    .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // expireStale
    .mockResolvedValueOnce({ rows: [] })               // fetchPendingWithHash
    .mockResolvedValueOnce({ rows: intents });          // fetchPendingIntentsWithHash
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  stopSolanaListener();
});

describe('Phase 9: Solana listener settlement integration', () => {
  describe('emitSettlementEvent (hash_submitted)', () => {
    it('emits hash_submitted event on every poll for each pending intent', async () => {
      setupQueryMocks();
      // Not confirmed yet — just observed
      mockVerify.mockResolvedValue({ valid: false, error: 'not yet on-chain' });

      startSolanaListener();
      // Give the immediate poll cycle time to complete
      await new Promise((r) => setTimeout(r, 50));

      expect(mockEmitSettlementEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'hash_submitted',
          protocol: 'solana',
          intentId: PENDING_INTENT_ROW.intentId,
          externalRef: PENDING_INTENT_ROW.txHash,
        }),
      );
    });

    it('includes merchantId and recipientAddress in the hash_submitted payload', async () => {
      setupQueryMocks();
      mockVerify.mockResolvedValue({ valid: false });

      startSolanaListener();
      await new Promise((r) => setTimeout(r, 50));

      const call = mockEmitSettlementEvent.mock.calls[0][0];
      expect(call.payload).toMatchObject({
        txHash: PENDING_INTENT_ROW.txHash,
        merchantId: PENDING_INTENT_ROW.merchantId,
        recipientAddress: PENDING_INTENT_ROW.recipientAddress,
      });
    });
  });

  describe('ingestSolanaProof (on confirmation)', () => {
    it('calls ingestSolanaProof with confirmed=true after on-chain verification', async () => {
      setupQueryMocks();
      mockVerify.mockResolvedValue(CONFIRMED_VERIFICATION);
      mockRunEngine.mockResolvedValue({
        resolution: { id: 'res-001' },
        evaluation: {
          decision: 'matched',
          reasonCode: 'identity_confirmed',
          resolutionStatus: 'confirmed',
          confidenceScore: 0.98,
        },
        wasAlreadyResolved: false,
      });
      mockPrismaTransactionsCreate.mockResolvedValue({ id: 'tx-001' });

      startSolanaListener();
      await new Promise((r) => setTimeout(r, 100));

      expect(mockIngestSolana).toHaveBeenCalledWith(
        expect.objectContaining({
          txHash: PENDING_INTENT_ROW.txHash,
          recipient: PENDING_INTENT_ROW.recipientAddress,
          amountUsdc: 10.0,
          confirmed: true,
          confirmationDepth: 3,
          sender: CONFIRMED_VERIFICATION.payer,
        }),
        expect.objectContaining({ intentId: PENDING_INTENT_ROW.intentId }),
      );
    });

    it('does NOT call ingestSolanaProof when tx is not yet valid', async () => {
      setupQueryMocks();
      mockVerify.mockResolvedValue({ valid: false, error: 'not found' });

      startSolanaListener();
      await new Promise((r) => setTimeout(r, 50));

      expect(mockIngestSolana).not.toHaveBeenCalled();
    });

    it('does NOT call ingestSolanaProof when awaiting more confirmations', async () => {
      setupQueryMocks();
      mockVerify.mockResolvedValue({ valid: true, verified: false, confirmationDepth: 1 });

      startSolanaListener();
      await new Promise((r) => setTimeout(r, 50));

      expect(mockIngestSolana).not.toHaveBeenCalled();
    });
  });

  describe('runResolutionEngine', () => {
    it('calls runResolutionEngine with correct params on confirmation', async () => {
      setupQueryMocks();
      mockVerify.mockResolvedValue(CONFIRMED_VERIFICATION);
      mockRunEngine.mockResolvedValue({
        resolution: { id: 'res-001' },
        evaluation: {
          decision: 'matched',
          reasonCode: 'identity_confirmed',
          resolutionStatus: 'confirmed',
          confidenceScore: 0.95,
        },
        wasAlreadyResolved: false,
      });
      mockPrismaTransactionsCreate.mockResolvedValue({ id: 'tx-001' });

      startSolanaListener();
      await new Promise((r) => setTimeout(r, 100));

      expect(mockRunEngine).toHaveBeenCalledWith(
        expect.objectContaining({
          intentId: PENDING_INTENT_ROW.intentId,
          expectedAmountUsdc: 10.0,
          merchantWallet: PENDING_INTENT_ROW.recipientAddress,
          verificationToken: PENDING_INTENT_ROW.verificationToken,
          resolvedBy: 'solana_listener',
          proof: expect.objectContaining({
            protocol: 'solana',
            proofType: 'solana_tx_hash',
            externalRef: PENDING_INTENT_ROW.txHash,
            observedStatus: 'confirmed',
          }),
        }),
      );
    });

    it('proof.observedStatus is "confirmed" when tx is verified', async () => {
      setupQueryMocks();
      mockVerify.mockResolvedValue(CONFIRMED_VERIFICATION);
      mockRunEngine.mockResolvedValue({
        resolution: { id: 'res-001' },
        evaluation: { decision: 'matched', reasonCode: 'identity_confirmed', resolutionStatus: 'confirmed', confidenceScore: 0.95 },
        wasAlreadyResolved: false,
      });
      mockPrismaTransactionsCreate.mockResolvedValue({ id: 'tx-001' });

      startSolanaListener();
      await new Promise((r) => setTimeout(r, 100));

      const engineCall = mockRunEngine.mock.calls[0][0];
      expect(engineCall.proof.observedStatus).toBe('confirmed');
    });

    it('still runs prisma.$transaction even when engine throws', async () => {
      setupQueryMocks();
      mockVerify.mockResolvedValue(CONFIRMED_VERIFICATION);
      mockRunEngine.mockRejectedValue(new Error('engine exploded'));
      mockPrismaTransactionsCreate.mockResolvedValue({ id: 'tx-001' });

      startSolanaListener();
      await new Promise((r) => setTimeout(r, 100));

      // Legacy-compatible claim must have created the transactions row
      expect(mockPrismaTransactionsCreate).toHaveBeenCalled();
    });

    it('logs resolution result including reasonCode', async () => {
      setupQueryMocks();
      mockVerify.mockResolvedValue(CONFIRMED_VERIFICATION);
      mockRunEngine.mockResolvedValue({
        resolution: { id: 'res-002' },
        evaluation: {
          decision: 'unmatched',
          reasonCode: 'recipient_mismatch',
          resolutionStatus: 'failed',
          confidenceScore: 0.0,
        },
        wasAlreadyResolved: false,
      });
      mockPrismaTransactionsCreate.mockResolvedValue({ id: 'tx-001' });

      // We just verify it doesn't throw and prisma tx still runs
      startSolanaListener();
      await new Promise((r) => setTimeout(r, 100));

      expect(mockPrismaTransactionsCreate).toHaveBeenCalled();
    });
  });

  describe('verificationToken and externalRef in query', () => {
    it('passes verificationToken from DB row to the engine', async () => {
      setupQueryMocks([{ ...PENDING_INTENT_ROW, verificationToken: 'special-vt-xyz' }]);
      mockVerify.mockResolvedValue(CONFIRMED_VERIFICATION);
      mockRunEngine.mockResolvedValue({
        resolution: { id: 'res-003' },
        evaluation: { decision: 'matched', reasonCode: 'identity_confirmed', resolutionStatus: 'confirmed', confidenceScore: 1.0 },
        wasAlreadyResolved: false,
      });
      mockPrismaTransactionsCreate.mockResolvedValue({ id: 'tx-001' });

      startSolanaListener();
      await new Promise((r) => setTimeout(r, 100));

      const engineCall = mockRunEngine.mock.calls[0][0];
      expect(engineCall.verificationToken).toBe('special-vt-xyz');
    });

    it('handles null verificationToken gracefully', async () => {
      setupQueryMocks([{ ...PENDING_INTENT_ROW, verificationToken: null }]);
      mockVerify.mockResolvedValue(CONFIRMED_VERIFICATION);
      mockRunEngine.mockResolvedValue({
        resolution: { id: 'res-004' },
        evaluation: { decision: 'matched', reasonCode: 'identity_confirmed', resolutionStatus: 'confirmed', confidenceScore: 1.0 },
        wasAlreadyResolved: false,
      });
      mockPrismaTransactionsCreate.mockResolvedValue({ id: 'tx-001' });

      startSolanaListener();
      await new Promise((r) => setTimeout(r, 100));

      const engineCall = mockRunEngine.mock.calls[0][0];
      expect(engineCall.verificationToken).toBeNull();
    });
  });

  describe('legacy path backward compatibility', () => {
    it('still calls prisma.$transaction on confirmed tx', async () => {
      setupQueryMocks();
      mockVerify.mockResolvedValue(CONFIRMED_VERIFICATION);
      mockRunEngine.mockResolvedValue({
        resolution: { id: 'res-005' },
        evaluation: { decision: 'matched', reasonCode: 'identity_confirmed', resolutionStatus: 'confirmed', confidenceScore: 1.0 },
        wasAlreadyResolved: false,
      });
      mockPrismaTransactionsCreate.mockResolvedValue({ id: 'tx-001' });

      startSolanaListener();
      await new Promise((r) => setTimeout(r, 100));

      expect(mockPrismaTransactionsCreate).toHaveBeenCalled();
    });

    it('does NOT call prisma.$transaction when tx is not confirmed', async () => {
      setupQueryMocks();
      mockVerify.mockResolvedValue({ valid: false });

      startSolanaListener();
      await new Promise((r) => setTimeout(r, 50));

      expect(mockPrismaTransactionsCreate).not.toHaveBeenCalled();
    });
  });

  describe('claim idempotency', () => {
    it('finalizes once and triggers side-effects exactly once', async () => {
      // two identical polls but first should claim and run side-effects
      setupQueryMocks();
      setupQueryMocks();
      mockVerify.mockResolvedValue(CONFIRMED_VERIFICATION);
      mockRunEngine.mockResolvedValue({
        resolution: { id: 'res-id' },
        evaluation: { decision: 'matched', reasonCode: 'identity_confirmed', resolutionStatus: 'confirmed', confidenceScore: 0.99 },
        wasAlreadyResolved: false,
      });
      // create resolves
      mockPrismaTransactionsCreate.mockResolvedValue({ id: 'tx-claim-1' });

      startSolanaListener();
      await new Promise((r) => setTimeout(r, 150));

      expect(mockPrismaTransactionsCreate).toHaveBeenCalledTimes(1);
      expect(mockIngestSolana).toHaveBeenCalledTimes(1);
      expect(mockRunEngine).toHaveBeenCalledTimes(1);
    });

    it('skips side-effects on duplicate claim (P2002)', async () => {
      // two intents in the same poll: first succeeds, second hits unique violation
      const withWebhook = { ...PENDING_INTENT_ROW, webhookUrl: 'https://example.com/hook' };
      setupQueryMocks([withWebhook, withWebhook]);
      mockVerify.mockResolvedValue(CONFIRMED_VERIFICATION);

      // First create succeeds, second throws unique violation
      mockPrismaTransactionsCreate
        .mockImplementationOnce(() => Promise.resolve({ id: 'tx-claim-1' }))
        .mockImplementationOnce(() => { const e: any = new Error('unique'); e.code = 'P2002'; throw e; });

      mockRunEngine.mockResolvedValue({
        resolution: { id: 'res-id-2' },
        evaluation: { decision: 'matched', reasonCode: 'identity_confirmed', resolutionStatus: 'confirmed', confidenceScore: 1.0 },
        wasAlreadyResolved: false,
      });

      startSolanaListener();
      await new Promise((r) => setTimeout(r, 150));

      // ingest/run/update/webhook/revenue only happened once (first successful claim)
      expect(mockPrismaTransactionsCreate).toHaveBeenCalledTimes(2); // attempted for both intents in the poll
      expect(mockIngestSolana).toHaveBeenCalledTimes(1);
      expect(mockRunEngine).toHaveBeenCalledTimes(1);
      expect(mockScheduleWebhook).toHaveBeenCalledTimes(1);
      expect(mockPrismaPaymentIntentUpdateMany).toHaveBeenCalledTimes(1);
      expect(mockRevenueProcess).not.toHaveBeenCalled();
    });

    it('does not finalize when tx is invalid/non-matching', async () => {
      setupQueryMocks();
      mockVerify.mockResolvedValue({ valid: false, error: 'not found' });

      startSolanaListener();
      await new Promise((r) => setTimeout(r, 50));

      expect(mockPrismaTransactionsCreate).not.toHaveBeenCalled();
      expect(mockIngestSolana).not.toHaveBeenCalled();
      expect(mockRunEngine).not.toHaveBeenCalled();
    });
  });
});
