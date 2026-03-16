/**
 * Route tests for /api/wallets — hosted wallet CRUD.
 * walletService is mocked. Auth is mocked.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  pool: { on: jest.fn() },
  closePool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    merchant: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    paymentIntent: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    verificationCertificate: { create: jest.fn() },
    agentrank_scores: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    agent: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    agent_wallets: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock('../../src/services/walletService', () => ({
  createWallet: jest.fn(),
  getWallet: jest.fn(),
  syncBalance: jest.fn(),
  sendUsdc: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  authenticateApiKey: (_req: any, _res: any, next: any) => {
    _req.merchant = { id: 'merchant-001', name: 'Test', email: 't@t.com', walletAddress: 'wa' };
    next();
  },
}));

import request from 'supertest';
import app from '../../src/server';
import * as walletService from '../../src/services/walletService';

const mockCreate = walletService.createWallet as jest.Mock;
const mockGet = walletService.getWallet as jest.Mock;
const mockSync = walletService.syncBalance as jest.Mock;
const mockSend = walletService.sendUsdc as jest.Mock;

const MOCK_WALLET = {
  agentId: 'agent-wallet-001',
  publicKey: 'So1anaPubKey11111111111111111111111111111111',
  balanceUsdc: 0,
  label: null,
  isActive: true,
  createdAt: new Date(),
};

describe('POST /api/wallets/create', () => {
  beforeEach(() => jest.resetAllMocks());

  it('returns 201 with wallet info on success', async () => {
    mockCreate.mockResolvedValueOnce(MOCK_WALLET);
    const res = await request(app)
      .post('/api/wallets/create')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ agentId: 'agent-wallet-001' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.wallet.publicKey).toBe(MOCK_WALLET.publicKey);
    expect(res.body.message).toContain('encrypted');
  });

  it('returns 409 when wallet already exists', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Wallet already exists for agent agent-001'));
    const res = await request(app)
      .post('/api/wallets/create')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ agentId: 'agent-001' });
    expect(res.status).toBe(409);
  });

  it('returns 400 when agentId is missing', async () => {
    const res = await request(app)
      .post('/api/wallets/create')
      .set('Authorization', 'sk_test_sim_12345')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when agentId is empty string', async () => {
    const res = await request(app)
      .post('/api/wallets/create')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ agentId: '' });
    expect(res.status).toBe(400);
  });

  it('returns 500 on unexpected service error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Keypair generation failed'));
    const res = await request(app)
      .post('/api/wallets/create')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ agentId: 'agent-err' });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/wallets/:agentId', () => {
  beforeEach(() => jest.resetAllMocks());

  it('returns 200 with wallet info', async () => {
    mockGet.mockResolvedValueOnce(MOCK_WALLET);
    const res = await request(app)
      .get('/api/wallets/agent-wallet-001')
      .set('Authorization', 'sk_test_sim_12345');

    expect(res.status).toBe(200);
    expect(res.body.wallet.agentId).toBe('agent-wallet-001');
  });

  it('returns 404 when wallet not found', async () => {
    mockGet.mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/api/wallets/unknown-agent')
      .set('Authorization', 'sk_test_sim_12345');
    expect(res.status).toBe(404);
  });

  it('returns 500 on service error', async () => {
    mockGet.mockRejectedValueOnce(new Error('DB failure'));
    const res = await request(app)
      .get('/api/wallets/agent-err')
      .set('Authorization', 'sk_test_sim_12345');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/wallets/:agentId/balance', () => {
  beforeEach(() => jest.resetAllMocks());

  it('returns 200 with on-chain balance', async () => {
    mockGet.mockResolvedValueOnce({ ...MOCK_WALLET, balanceUsdc: 100 });
    mockSync.mockResolvedValueOnce(105.5);

    const res = await request(app)
      .get('/api/wallets/agent-wallet-001/balance')
      .set('Authorization', 'sk_test_sim_12345');

    expect(res.status).toBe(200);
    expect(res.body.balanceUsdc).toBe(105.5);
    expect(res.body.source).toBe('on-chain');
  });

  it('falls back to DB balance when RPC unavailable (syncBalance returns null)', async () => {
    mockGet.mockResolvedValueOnce({ ...MOCK_WALLET, balanceUsdc: 42 });
    mockSync.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/wallets/agent-wallet-001/balance')
      .set('Authorization', 'sk_test_sim_12345');

    expect(res.status).toBe(200);
    expect(res.body.balanceUsdc).toBe(42);
    expect(res.body.source).toBe('db-cache');
  });

  it('returns 404 when wallet not found', async () => {
    mockGet.mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/api/wallets/no-wallet/balance')
      .set('Authorization', 'sk_test_sim_12345');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/wallets/:agentId/send', () => {
  beforeEach(() => jest.resetAllMocks());

  const VALID_SOLANA_ADDRESS = 'So1anaPubKey11111111111111111111111111111111';

  it('returns 200 with transaction signature on success', async () => {
    mockSend.mockResolvedValueOnce({
      signature: 'tx-sig-abc123',
      amountUsdc: 10,
      toAddress: VALID_SOLANA_ADDRESS,
      onChain: true,
    });

    const res = await request(app)
      .post('/api/wallets/agent-wallet-001/send')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ toAddress: VALID_SOLANA_ADDRESS, amountUsdc: 10 });

    expect(res.status).toBe(200);
    expect(res.body.signature).toBe('tx-sig-abc123');
  });

  it('returns 400 when amountUsdc is zero', async () => {
    const res = await request(app)
      .post('/api/wallets/agent-wallet-001/send')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ toAddress: VALID_SOLANA_ADDRESS, amountUsdc: 0 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when amountUsdc is negative', async () => {
    const res = await request(app)
      .post('/api/wallets/agent-wallet-001/send')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ toAddress: VALID_SOLANA_ADDRESS, amountUsdc: -5 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when toAddress is too short', async () => {
    const res = await request(app)
      .post('/api/wallets/agent-wallet-001/send')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ toAddress: 'short', amountUsdc: 10 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when toAddress is missing', async () => {
    const res = await request(app)
      .post('/api/wallets/agent-wallet-001/send')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ amountUsdc: 10 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for insufficient balance', async () => {
    mockSend.mockRejectedValueOnce(new Error('Insufficient balance'));
    const res = await request(app)
      .post('/api/wallets/agent-wallet-001/send')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ toAddress: VALID_SOLANA_ADDRESS, amountUsdc: 999999 });
    expect(res.status).toBe(400);
  });

  it('returns 403 for deactivated wallet', async () => {
    mockSend.mockRejectedValueOnce(new Error('Wallet is deactivated'));
    const res = await request(app)
      .post('/api/wallets/agent-wallet-001/send')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ toAddress: VALID_SOLANA_ADDRESS, amountUsdc: 10 });
    expect(res.status).toBe(403);
  });

  it('returns 400 when amountUsdc exceeds server-side max', async () => {
    const res = await request(app)
      .post('/api/wallets/agent-wallet-001/send')
      .set('Authorization', 'sk_test_sim_12345')
      .send({ toAddress: VALID_SOLANA_ADDRESS, amountUsdc: 999_999_999 });
    expect(res.status).toBe(400);
  });
});