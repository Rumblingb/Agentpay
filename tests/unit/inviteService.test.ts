/**
 * Unit tests for inviteService — merchant invite code system.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
}));

import * as db from '../../src/db/index';
import {
  generateInviteCode,
  validateAndConsumeInvite,
  getMerchantInviteCodes,
  deactivateInviteCode,
} from '../../src/services/inviteService';

const mockQuery = db.query as jest.Mock;

const MERCHANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

describe('inviteService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateInviteCode', () => {
    it('generates a code with AP_ prefix', async () => {
      const inviteRow = {
        id: 'invite-uuid',
        code: 'AP_ABCDEF1234567890',
        merchantId: MERCHANT_ID,
        maxUses: 10,
        currentUses: 0,
        expiresAt: null,
        active: true,
        createdAt: new Date(),
      };
      mockQuery.mockResolvedValueOnce({ rows: [inviteRow] });

      const result = await generateInviteCode(MERCHANT_ID);

      expect(result.code).toBe('AP_ABCDEF1234567890');
      expect(result.merchantId).toBe(MERCHANT_ID);
      expect(result.maxUses).toBe(10);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('respects custom maxUses and expiresInDays', async () => {
      const inviteRow = {
        id: 'invite-uuid',
        code: 'AP_TEST123',
        merchantId: MERCHANT_ID,
        maxUses: 5,
        currentUses: 0,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        active: true,
        createdAt: new Date(),
      };
      mockQuery.mockResolvedValueOnce({ rows: [inviteRow] });

      const result = await generateInviteCode(MERCHANT_ID, 5, 7);

      expect(result.maxUses).toBe(5);
      expect(result.expiresAt).toBeDefined();
    });
  });

  describe('validateAndConsumeInvite', () => {
    it('returns valid:false for unknown code', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await validateAndConsumeInvite('INVALID_CODE');

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/Invalid invite code/i);
    });

    it('returns valid:false for inactive code', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'invite-uuid',
          code: 'AP_TEST',
          merchantId: MERCHANT_ID,
          max_uses: 10,
          current_uses: 0,
          expires_at: null,
          active: false,
        }],
      });

      const result = await validateAndConsumeInvite('AP_TEST');

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/no longer active/i);
    });

    it('returns valid:false for expired code', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'invite-uuid',
          code: 'AP_EXPIRED',
          merchantId: MERCHANT_ID,
          max_uses: 10,
          current_uses: 0,
          expires_at: new Date(Date.now() - 1000), // Past
          active: true,
        }],
      });

      const result = await validateAndConsumeInvite('AP_EXPIRED');

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/expired/i);
    });

    it('returns valid:false when max uses reached', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'invite-uuid',
          code: 'AP_MAXED',
          merchantId: MERCHANT_ID,
          max_uses: 5,
          current_uses: 5,
          expires_at: null,
          active: true,
        }],
      });

      const result = await validateAndConsumeInvite('AP_MAXED');

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/usage limit/i);
    });

    it('validates and increments usage for valid code', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'invite-uuid',
            code: 'AP_VALID',
            merchantId: MERCHANT_ID,
            max_uses: 10,
            current_uses: 3,
            expires_at: null,
            active: true,
          }],
        })
        .mockResolvedValueOnce({ rows: [] }); // UPDATE increment

      const result = await validateAndConsumeInvite('AP_VALID');

      expect(result.valid).toBe(true);
      expect(result.referrerMerchantId).toBe(MERCHANT_ID);
      expect(mockQuery).toHaveBeenCalledTimes(2); // SELECT + UPDATE
    });
  });

  describe('getMerchantInviteCodes', () => {
    it('returns invite codes for a merchant', async () => {
      const codes = [
        { id: '1', code: 'AP_CODE1', merchantId: MERCHANT_ID, maxUses: 10, currentUses: 2, active: true },
        { id: '2', code: 'AP_CODE2', merchantId: MERCHANT_ID, maxUses: 5, currentUses: 5, active: true },
      ];
      mockQuery.mockResolvedValueOnce({ rows: codes });

      const result = await getMerchantInviteCodes(MERCHANT_ID);

      expect(result).toHaveLength(2);
      expect(result[0].code).toBe('AP_CODE1');
    });
  });

  describe('deactivateInviteCode', () => {
    it('returns true when code is deactivated', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const result = await deactivateInviteCode('invite-uuid', MERCHANT_ID);
      expect(result).toBe(true);
    });

    it('returns false when code not found or not owned', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const result = await deactivateInviteCode('wrong-uuid', MERCHANT_ID);
      expect(result).toBe(false);
    });
  });
});
