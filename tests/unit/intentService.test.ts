/**
 * Unit tests for intentService — Prisma client is mocked so no live DB is required.
 */

// ---- Mock the Prisma singleton BEFORE any imports that use it ----
const mockFindUniqueOrThrow = jest.fn();
const mockCreate = jest.fn();
const mockFindFirst = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    merchant: { findUniqueOrThrow: mockFindUniqueOrThrow },
    paymentIntent: {
      create: mockCreate,
      findFirst: mockFindFirst,
      update: mockUpdate,
    },
  },
}));

import { createIntent, getIntentStatus } from '../../src/services/intentService';

describe('intentService', () => {
  const merchantId = 'merchant-uuid-1234';
  const walletAddress = '5YNmS1R9n7VBjnMjhkKLhUXZhiANpvKaQYV8j8PqDxx'; // 44-char mock Solana address

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindUniqueOrThrow.mockResolvedValue({ walletAddress });
    mockCreate.mockResolvedValue({});
  });

  describe('createIntent', () => {
    it('returns intentId, verificationToken, expiresAt and instructions', async () => {
      const result = await createIntent({ merchantId, amount: 5, currency: 'USDC' });

      expect(result.intentId).toBeDefined();
      expect(result.verificationToken).toMatch(/^APV_\d+_[0-9a-f]+$/);
      expect(result.expiresAt).toBeInstanceOf(Date);

      // expiresAt should be roughly 30 minutes from now
      const diffMs = result.expiresAt.getTime() - Date.now();
      expect(diffMs).toBeGreaterThan(29 * 60 * 1000);
      expect(diffMs).toBeLessThan(31 * 60 * 1000);

      expect(result.instructions.recipientAddress).toBe(walletAddress);
      expect(result.instructions.memo).toBe(result.verificationToken);
      expect(result.instructions.solanaPayUri).toContain(walletAddress);
      expect(result.instructions.solanaPayUri).toContain(result.verificationToken);
    });

    it('persists the intent via prisma.paymentIntent.create', async () => {
      await createIntent({ merchantId, amount: 10, currency: 'USDC' });
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const createArg = mockCreate.mock.calls[0][0].data;
      expect(createArg.merchantId).toBe(merchantId);
      expect(createArg.amount).toBe(10);
      expect(createArg.currency).toBe('USDC');
      expect(createArg.status).toBe('pending');
    });

    it('looks up the merchant wallet before creating', async () => {
      await createIntent({ merchantId, amount: 1, currency: 'USDC' });
      expect(mockFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: merchantId },
        select: { walletAddress: true },
      });
    });
  });

  describe('getIntentStatus', () => {
    const baseIntent = {
      id: 'intent-uuid-5678',
      status: 'pending',
      amount: 5,
      currency: 'USDC',
      expiresAt: new Date(Date.now() + 20 * 60 * 1000), // 20 min in future
      verificationToken: 'APV_1700000000000_aabbccdd',
    };

    it('returns intent status for a valid intent', async () => {
      mockFindFirst.mockResolvedValue(baseIntent);
      const result = await getIntentStatus(baseIntent.id, merchantId);

      expect(result).not.toBeNull();
      expect(result!.intentId).toBe(baseIntent.id);
      expect(result!.status).toBe('pending');
      expect(result!.amount).toBe(5);
    });

    it('returns null when intent does not exist', async () => {
      mockFindFirst.mockResolvedValue(null);
      const result = await getIntentStatus('nonexistent', merchantId);
      expect(result).toBeNull();
    });

    it('auto-expires an overdue pending intent', async () => {
      const expiredIntent = {
        ...baseIntent,
        expiresAt: new Date(Date.now() - 1000), // 1 second in the past
      };
      mockFindFirst.mockResolvedValue(expiredIntent);
      mockUpdate.mockResolvedValue({});

      const result = await getIntentStatus(expiredIntent.id, merchantId);

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: expiredIntent.id },
        data: { status: 'expired' },
      });
      expect(result!.status).toBe('expired');
    });
  });
});
