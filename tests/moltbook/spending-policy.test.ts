/**
 * Unit tests for moltbookService — spending policy decisions.
 * db.query is mocked so no live database is required.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
}));

import * as db from '../../src/db/index';
import {
  checkSpendingPolicy,
  getSpendingPolicy,
  updateSpendingPolicy,
} from '../../src/services/moltbookService';

const mockQuery = db.query as jest.Mock;

const BOT_UUID = 'aaaaaaaa-0000-0000-0000-000000000001';
const PLATFORM_BOT_ID = 'moltbook-bot-001';

// A policy row returned by the DB
const BASE_POLICY_ROW = {
  id: BOT_UUID,
  daily_spending_limit: '10.00',
  per_tx_limit: '2.00',
  auto_approve_under: '0.50',
  daily_auto_approve_cap: '5.00',
  require_pin_above: null,
  alert_webhook_url: null,
  pin_hash: null,
};

describe('moltbookService — spending policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── getSpendingPolicy ──────────────────────────────────────────────────

  describe('getSpendingPolicy', () => {
    it('returns the policy for a valid bot', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] }) // resolveBotId
        .mockResolvedValueOnce({ rows: [BASE_POLICY_ROW] }); // SELECT policy

      const policy = await getSpendingPolicy(BOT_UUID);

      expect(policy).not.toBeNull();
      expect(policy!.dailySpendingLimit).toBe(10);
      expect(policy!.perTxLimit).toBe(2);
      expect(policy!.autoApproveUnder).toBe(0.5);
      expect(policy!.dailyAutoApproveCap).toBe(5);
      expect(policy!.requirePinAbove).toBeNull();
      expect(policy!.alertWebhookUrl).toBeNull();
    });

    it('returns null when bot not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // resolveBotId → not found
      const policy = await getSpendingPolicy('nonexistent-bot');
      expect(policy).toBeNull();
    });
  });

  // ── checkSpendingPolicy ────────────────────────────────────────────────

  describe('checkSpendingPolicy', () => {
    function setupPolicy(overrides: Partial<typeof BASE_POLICY_ROW> = {}) {
      const row = { ...BASE_POLICY_ROW, ...overrides };
      // resolveBotId, SELECT policy, today's total spend, today's auto-approved spend
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] })
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })  // today spend
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }); // auto-approved spend
    }

    it('approves and auto-approves a small spend under all limits', async () => {
      setupPolicy();
      const result = await checkSpendingPolicy(BOT_UUID, 0.25);
      expect(result.approved).toBe(true);
      expect(result.autoApproved).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('approves but does NOT auto-approve when amount >= auto_approve_under', async () => {
      setupPolicy();
      const result = await checkSpendingPolicy(BOT_UUID, 1.00);
      expect(result.approved).toBe(true);
      expect(result.autoApproved).toBe(false);
    });

    it('rejects when amount exceeds per_tx_limit', async () => {
      setupPolicy();
      const result = await checkSpendingPolicy(BOT_UUID, 3.00);
      expect(result.approved).toBe(false);
      expect(result.reason).toMatch(/Transaction limit/i);
    });

    it('rejects when cumulative daily spend would exceed daily_spending_limit', async () => {
      // resolveBotId, SELECT policy, today spent = 9.50
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] })
        .mockResolvedValueOnce({ rows: [BASE_POLICY_ROW] })
        .mockResolvedValueOnce({ rows: [{ total: '9.50' }] }) // today spent
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });  // auto-approved

      const result = await checkSpendingPolicy(BOT_UUID, 1.00); // 9.50 + 1.00 > 10.00
      expect(result.approved).toBe(false);
      expect(result.reason).toMatch(/Daily spending limit/i);
      expect(result.remainingDaily).toBeCloseTo(0.5);
    });

    it('returns approved:false when bot not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // resolveBotId → not found
      const result = await checkSpendingPolicy('unknown-bot', 1.00);
      expect(result.approved).toBe(false);
      expect(result.reason).toMatch(/Bot not found/i);
    });

    it('requires PIN when amount >= require_pin_above and no PIN provided', async () => {
      setupPolicy({ require_pin_above: '1.00' });
      const result = await checkSpendingPolicy(BOT_UUID, 1.50);
      expect(result.approved).toBe(false);
      expect(result.requiresPin).toBe(true);
      expect(result.reason).toMatch(/PIN required/i);
    });

    it('rejects with invalid PIN', async () => {
      // pin_hash is bcrypt of "correct-pin"
      const bcrypt = require('bcrypt');
      const pinHash = await bcrypt.hash('correct-pin', 10);

      // resolveBotId, SELECT policy (with pin_hash), today spend, auto-approved spend
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] })
        .mockResolvedValueOnce({ rows: [{ ...BASE_POLICY_ROW, require_pin_above: '1.00', pin_hash: pinHash }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      const result = await checkSpendingPolicy(BOT_UUID, 1.50, 'wrong-pin');
      expect(result.approved).toBe(false);
      expect(result.requiresPin).toBe(true);
      expect(result.reason).toMatch(/Invalid PIN/i);
    });

    it('approves with correct PIN', async () => {
      const bcrypt = require('bcrypt');
      const pinHash = await bcrypt.hash('correct-pin', 10);

      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] })
        .mockResolvedValueOnce({ rows: [{ ...BASE_POLICY_ROW, require_pin_above: '1.00', pin_hash: pinHash }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      const result = await checkSpendingPolicy(BOT_UUID, 1.50, 'correct-pin');
      expect(result.approved).toBe(true);
    });

    it('falls back to manual approval when daily auto-approve cap is reached', async () => {
      // auto-approve cap = 5, already auto-approved 4.80 today, new tx = 0.40
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] })
        .mockResolvedValueOnce({ rows: [BASE_POLICY_ROW] })
        .mockResolvedValueOnce({ rows: [{ total: '4.80' }] }) // today total spend
        .mockResolvedValueOnce({ rows: [{ total: '4.80' }] }); // today auto-approved

      const result = await checkSpendingPolicy(BOT_UUID, 0.40); // would be auto-approved (< 0.50) but cap hit
      expect(result.approved).toBe(true);
      expect(result.autoApproved).toBe(false);
      expect(result.reason).toMatch(/auto-approve cap/i);
      expect(result.remainingAutoApproveDaily).toBe(0);
    });
  });

  // ── updateSpendingPolicy ───────────────────────────────────────────────

  describe('updateSpendingPolicy', () => {
    it('updates specified fields and returns updated policy', async () => {
      const updatedRow = { ...BASE_POLICY_ROW, daily_spending_limit: '20.00', per_tx_limit: '5.00' };

      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] })  // resolveBotId (updateSpendingPolicy)
        .mockResolvedValueOnce({ rows: [] })                   // UPDATE query
        .mockResolvedValueOnce({ rows: [{ id: BOT_UUID }] })  // resolveBotId (getSpendingPolicy)
        .mockResolvedValueOnce({ rows: [updatedRow] });        // SELECT policy

      const policy = await updateSpendingPolicy(BOT_UUID, {
        dailySpendingLimit: 20,
        perTxLimit: 5,
      });

      expect(policy).not.toBeNull();
      expect(policy!.dailySpendingLimit).toBe(20);
      expect(policy!.perTxLimit).toBe(5);

      // Ensure UPDATE was called with correct columns
      const updateCall = mockQuery.mock.calls[1];
      expect(updateCall[0]).toContain('daily_spending_limit');
      expect(updateCall[0]).toContain('per_tx_limit');
    });

    it('returns null when bot not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // resolveBotId → not found
      const policy = await updateSpendingPolicy('nonexistent', { perTxLimit: 1 });
      expect(policy).toBeNull();
    });
  });
});
