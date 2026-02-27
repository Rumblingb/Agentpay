/**
 * Unit tests for moltbookService — bot registration with smart defaults.
 * db.query and Keypair are mocked so no live database or Solana RPC is required.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
}));

// Mock Solana Keypair so tests don't need a real keypair
jest.mock('@solana/web3.js', () => ({
  Keypair: {
    generate: jest.fn(() => ({
      publicKey: { toString: () => 'TestWalletAddress11111111111111111111111111' },
    })),
  },
}));

import * as db from '../../src/db/index';
import { registerBot } from '../../src/services/moltbookService';

const mockQuery = db.query as jest.Mock;

const FAKE_BOT_ID = 'bbbbbbbb-1111-1111-1111-000000000002';
const FAKE_WALLET = 'TestWalletAddress11111111111111111111111111';

describe('moltbookService — registerBot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers a bot with only handle provided, using smart defaults', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: FAKE_BOT_ID,
          platform_bot_id: 'auto-generated-uuid',
          handle: '@MyBot',
          wallet_address: FAKE_WALLET,
        },
      ],
    });

    const result = await registerBot('@MyBot');

    expect(result).not.toBeNull();
    expect(result!.handle).toBe('@MyBot');
    expect(result!.walletAddress).toBe(FAKE_WALLET);
    expect(result!.botId).toBe(FAKE_BOT_ID);

    // Verify the INSERT used smart defaults
    const insertCall = mockQuery.mock.calls[0];
    const sql: string = insertCall[0];
    const values: unknown[] = insertCall[1];

    expect(sql).toContain('INSERT INTO bots');
    // display_name defaults to handle
    expect(values[2]).toBe('@MyBot');
    // daily_spending_limit = 10
    expect(values[8]).toBe(10);
    // per_tx_limit = 2
    expect(values[9]).toBe(2);
    // auto_approve_under = 0.5
    expect(values[10]).toBe(0.5);
  });

  it('registers a bot with custom display_name overriding handle default', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: FAKE_BOT_ID,
          platform_bot_id: 'auto-uuid',
          handle: '@MyBot',
          wallet_address: FAKE_WALLET,
        },
      ],
    });

    const result = await registerBot('@MyBot', { display_name: 'My Awesome Bot' });

    expect(result).not.toBeNull();
    const values: unknown[] = mockQuery.mock.calls[0][1];
    // display_name should be the provided value, not the handle
    expect(values[2]).toBe('My Awesome Bot');
  });

  it('returns null and does not throw when a duplicate handle is inserted', async () => {
    mockQuery.mockRejectedValueOnce({ message: 'duplicate key value violates unique constraint' });

    const result = await registerBot('@DuplicateBot');

    expect(result).toBeNull();
  });

  it('includes spendingPolicy in the returned result', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: FAKE_BOT_ID,
          platform_bot_id: 'p1',
          handle: '@Bot',
          wallet_address: FAKE_WALLET,
        },
      ],
    });

    const result = await registerBot('@Bot');

    expect(result!.spendingPolicy).toEqual({
      dailyMax: 10,
      perTxMax: 2,
      autoApproveUnder: 0.5,
    });
  });
});
