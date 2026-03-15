/* Unit test: solana listener should call RevenueController when ENABLE_ONCHAIN_FEE_LOGGING is enabled */

// Mocks (must come before imports)

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  pool: { on: jest.fn() },
  closePool: jest.fn().mockResolvedValue(undefined),
}));

// Mock logger to avoid requiring `pino` at test runtime
jest.mock('../../src/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
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

// Mock RevenueController
const mockProcessOnChainVerification = jest.fn().mockResolvedValue({ id: 'rev-uuid-1' });
jest.mock('../../src/controllers/revenueController', () => ({
  RevenueController: {
    processOnChainVerification: mockProcessOnChainVerification,
  },
}));

// Imports (after mocks)
import { startSolanaListener, stopSolanaListener } from '../../src/services/solana-listener';
import { query } from '../../src/db/index';
import { verifyPaymentRecipient } from '../../src/security/payment-verification';

const mockQuery = query as jest.Mock;
const mockVerify = verifyPaymentRecipient as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ENABLE_ONCHAIN_FEE_LOGGING = 'true';
});

afterEach(() => {
  stopSolanaListener();
  delete process.env.ENABLE_ONCHAIN_FEE_LOGGING;
});

it('calls RevenueController.processOnChainVerification when enabled (intent path)', async () => {
  // Setup query sequence: expireStale, fetchPendingWithHash -> [], fetchPendingIntentsWithHash -> [intent]
  const PENDING_INTENT_ROW = {
    intentId: 'intent-uuid-rev-001',
    merchantId: 'merchant-uuid-rev-001',
    amountUsdc: 25.0,
    recipientAddress: 'MerchantWalletRev111111111111111111111111111',
    txHash: 'TxHashRev1111111111111111111111111111111111',
    verificationToken: null,
    externalRef: null,
    metadata: {},
    webhookUrl: null,
  };

  mockQuery
    .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // expireStale
    .mockResolvedValueOnce({ rows: [] }) // fetchPendingWithHash
    .mockResolvedValueOnce({ rows: [PENDING_INTENT_ROW] }); // fetchPendingIntentsWithHash

  mockVerify.mockResolvedValue({ valid: true, verified: true, payer: 'PayerAddrRev', confirmationDepth: 2 });

  startSolanaListener();
  await new Promise((r) => setTimeout(r, 100));

  expect(mockProcessOnChainVerification).toHaveBeenCalled();
  const callArgs = mockProcessOnChainVerification.mock.calls[0][0];
  expect(callArgs.amount_usdc).toBe(25.0);
  expect(callArgs.transaction_hash).toBe(PENDING_INTENT_ROW.txHash);
});
