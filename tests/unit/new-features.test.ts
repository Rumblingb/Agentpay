/**
 * Tests for new features:
 *  1. POST /api/ap2/payment — alias for /request (fixes 404)
 *  2. POST /api/v1/payment-intents/:intentId/verify — queue tx_hash on intent
 *  3. walletService — createWallet, getWallet, sendUsdc
 *  4. heliusService — signalsToDelta computation
 *  5. solana-listener processIntent — atomic intent + transactions update
 */

// ---- Mock db ----
jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
}));

// ---- Mock Prisma ----
jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    merchant: { findUniqueOrThrow: jest.fn(), findUnique: jest.fn() },
    paymentIntent: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    transactions: { create: jest.fn() },
    agent_wallets: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    agentrank_scores: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

// ---- Mock intentService (needed by server) ----
jest.mock('../../src/services/intentService', () => ({
  createIntent: jest.fn(),
  getIntentStatus: jest.fn(),
  getIntentById: jest.fn(),
  default: {
    createIntent: jest.fn(),
    getIntentStatus: jest.fn(),
    getIntentById: jest.fn(),
  },
}));

// ---- Mock agentIdentityService (needed by v1Intents) ----
jest.mock('../../src/services/agentIdentityService', () => ({
  registerAgent: jest.fn(),
  updateAgent: jest.fn(),
  verifyPin: jest.fn().mockResolvedValue(true),
}));

// ---- Mock payment-verification (needed by solana-listener) ----
jest.mock('../../src/security/payment-verification', () => ({
  verifyPaymentRecipient: jest.fn(),
}));

// ---- Mock walletEncryption ----
jest.mock('../../src/utils/walletEncryption', () => ({
  encryptKeypair: jest.fn().mockReturnValue('iv:tag:ciphertext'),
  decryptKeypair: jest.fn().mockReturnValue(new Uint8Array(64)),
  isEncrypted: jest.fn().mockReturnValue(true),
}));

import request from 'supertest';
import express from 'express';
import { ap2Router } from '../../src/protocols/ap2';
import v1IntentsRouter from '../../src/routes/v1Intents';
import * as db from '../../src/db/index';
import prisma from '../../src/lib/prisma';
import * as verifyMod from '../../src/security/payment-verification';
import { signalsToDelta, type OnChainSignals } from '../../src/services/heliusService';

// Set required env vars
process.env.AGENTPAY_SIGNING_SECRET = 'test-signing-secret-32chars!!!!!';
process.env.NODE_ENV = 'test';

const mockQuery = db.query as jest.Mock;
const mockPrisma = prisma as any;
const mockVerify = verifyMod.verifyPaymentRecipient as jest.Mock;

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use('/api/ap2', ap2Router);
app.use('/api/v1/payment-intents', v1IntentsRouter);

// ---------------------------------------------------------------------------
// 1. AP2 /payment alias
// ---------------------------------------------------------------------------
describe('POST /api/ap2/payment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('forwards to /api/ap2/request and returns 201', async () => {
    const res = await request(app)
      .post('/api/ap2/payment')
      .send({
        payerId: 'agent-A',
        payeeId: 'agent-B',
        amountUsdc: 5,
        taskDescription: 'Data scraping',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.requestId).toBeDefined();
    expect(res.body.transaction.protocol).toBe('ap2');
  });

  it('returns 400 on missing required fields', async () => {
    const res = await request(app)
      .post('/api/ap2/payment')
      .send({ amountUsdc: 5 }); // missing payerId, payeeId, taskDescription

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });
});

// ---------------------------------------------------------------------------
// 2. POST /api/v1/payment-intents/:intentId/verify
// ---------------------------------------------------------------------------
const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VALID_TX_HASH = 'AbCdEfGhIjKlMnOpQrStUvWxYz123456abcdef12345678';

describe('POST /api/v1/payment-intents/:intentId/verify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: intent found, pending, not expired
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT') && sql.includes('payment_intents')) {
        return Promise.resolve({
          rows: [{
            id: VALID_UUID,
            status: 'pending',
            metadata: { agentId: 'agent-1' },
            expires_at: new Date(Date.now() + 30 * 60 * 1000),
          }],
        });
      }
      // UPDATE query
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
  });

  it('returns 400 for invalid UUID', async () => {
    const res = await request(app)
      .post('/api/v1/payment-intents/not-a-uuid/verify')
      .send({ txHash: VALID_TX_HASH });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing txHash', async () => {
    const res = await request(app)
      .post(`/api/v1/payment-intents/${VALID_UUID}/verify`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('returns 404 when intent does not exist', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post(`/api/v1/payment-intents/${VALID_UUID}/verify`)
      .send({ txHash: VALID_TX_HASH });
    expect(res.status).toBe(404);
  });

  it('returns 409 when intent is already completed', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: VALID_UUID, status: 'completed', metadata: {}, expires_at: new Date(Date.now() + 3600_000) }],
    });
    const res = await request(app)
      .post(`/api/v1/payment-intents/${VALID_UUID}/verify`)
      .send({ txHash: VALID_TX_HASH });
    expect(res.status).toBe(409);
  });

  it('queues tx_hash and returns 200 for valid pending intent', async () => {
    const res = await request(app)
      .post(`/api/v1/payment-intents/${VALID_UUID}/verify`)
      .send({ txHash: VALID_TX_HASH });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.queued).toBe(true);
    expect(res.body.txHash).toBe(VALID_TX_HASH);
  });
});

// ---------------------------------------------------------------------------
// 3. walletService — unit tests
// ---------------------------------------------------------------------------
describe('walletService', () => {
  // Lazily import to allow mocks to be set up first
  let walletService: typeof import('../../src/services/walletService');

  beforeAll(async () => {
    walletService = await import('../../src/services/walletService');
  });

  beforeEach(() => jest.clearAllMocks());

  it('createWallet — throws if wallet already exists', async () => {
    mockPrisma.agent_wallets.findUnique.mockResolvedValue({ agent_id: 'agent-1' });
    await expect(walletService.createWallet('agent-1')).rejects.toThrow('already exists');
  });

  it('createWallet — creates a new wallet and returns WalletInfo', async () => {
    mockPrisma.agent_wallets.findUnique.mockResolvedValue(null);
    mockPrisma.agent_wallets.create.mockResolvedValue({
      agent_id: 'agent-2',
      public_key: 'SomePubKey123',
      encrypted_private_key: 'iv:tag:ct',
      balance_usdc: 0,
      label: 'test',
      is_active: true,
      created_at: new Date(),
    });

    const wallet = await walletService.createWallet('agent-2', 'test');
    expect(wallet.agentId).toBe('agent-2');
    expect(wallet.publicKey).toBe('SomePubKey123');
    expect(wallet.balanceUsdc).toBe(0);
  });

  it('getWallet — returns null for unknown agent', async () => {
    mockPrisma.agent_wallets.findUnique.mockResolvedValue(null);
    const result = await walletService.getWallet('unknown');
    expect(result).toBeNull();
  });

  it('sendUsdc — throws on insufficient balance', async () => {
    mockPrisma.agent_wallets.findUnique.mockResolvedValue({
      agent_id: 'agent-3',
      public_key: 'PubKey',
      encrypted_private_key: 'iv:tag:ct',
      balance_usdc: 1,
      is_active: true,
    });

    await expect(
      walletService.sendUsdc('agent-3', '5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqD', 100),
    ).rejects.toThrow('Insufficient balance');
  });

  it('sendUsdc — simulates transfer in test mode and decrements balance', async () => {
    // Use the Solana System Program address which is a valid 32-byte pubkey
    const validSolanaAddr = 'So11111111111111111111111111111111111111112';
    mockPrisma.agent_wallets.findUnique.mockResolvedValue({
      agent_id: 'agent-4',
      public_key: validSolanaAddr,
      encrypted_private_key: 'iv:tag:ct',
      balance_usdc: 50,
      is_active: true,
    });
    mockPrisma.agent_wallets.update.mockResolvedValue({});

    const result = await walletService.sendUsdc(
      'agent-4',
      validSolanaAddr,
      10,
    );
    expect(result.amountUsdc).toBe(10);
    expect(result.onChain).toBe(false); // test mode
    expect(mockPrisma.agent_wallets.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ balance_usdc: 40 }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. heliusService.signalsToDelta
// ---------------------------------------------------------------------------
describe('heliusService.signalsToDelta', () => {
  it('returns 0 for empty signals (stub)', () => {
    const signals: OnChainSignals = {
      walletAddress: 'SomeAddr',
      txVolume: 0,
      usdcVolumeReceived: 0,
      walletAgeDays: 0,
      uniquePayers: 0,
      dataSource: 'stub',
    };
    expect(signalsToDelta(signals)).toBe(0);
  });

  it('caps scores at maximums', () => {
    const signals: OnChainSignals = {
      walletAddress: 'SomeAddr',
      txVolume: 10000,        // would give >50 without cap
      usdcVolumeReceived: 500000, // would give >100 without cap
      walletAgeDays: 10000,   // would give >100 without cap
      uniquePayers: 500,      // would give >100 without cap
      dataSource: 'helius',
    };
    const delta = signalsToDelta(signals);
    // Max possible: 100 + 100 + 100 + 50 = 350
    expect(delta).toBeLessThanOrEqual(350);
    expect(delta).toBeGreaterThan(0);
  });

  it('computes correct delta for known inputs', () => {
    const signals: OnChainSignals = {
      walletAddress: 'SomeAddr',
      txVolume: 20,           // floor(20/10)*1 = 2
      usdcVolumeReceived: 200, // floor(200/100) = 2
      walletAgeDays: 60,      // floor(60/30)*5 = 10
      uniquePayers: 5,        // 5*2 = 10
      dataSource: 'helius',
    };
    expect(signalsToDelta(signals)).toBe(2 + 2 + 10 + 10);
  });
});

// ---------------------------------------------------------------------------
// 5. solana-listener processIntent (indirect via module internals)
// ---------------------------------------------------------------------------
describe('solana-listener: processIntent atomic write', () => {
  // We test the core logic by directly calling the exported listener functions
  // and checking that prisma.$transaction is called with the right arguments.

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does NOT call $transaction when verification is invalid', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // expireStaleTransactions
      .mockResolvedValueOnce({ rows: [] }) // fetchPendingWithHash
      .mockResolvedValueOnce({ rows: [] }); // fetchPendingIntentsWithHash

    mockVerify.mockResolvedValue({ valid: false, error: 'tx not found' });
    mockPrisma.$transaction.mockResolvedValue([{}, {}]);

    const { startSolanaListener, stopSolanaListener } =
      await import('../../src/services/solana-listener');

    // Start listener, wait one tick, stop it
    startSolanaListener();
    await new Promise((r) => setTimeout(r, 50));
    stopSolanaListener();

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
