/**
 * Unit tests for billingService — db.query is mocked.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
}));

import { billMerchant, getMerchantInvoices, PLATFORM_FEE_PERCENT } from '../../src/services/billingService';
import * as db from '../../src/db/index';

const mockQuery = db.query as jest.Mock;

const MERCHANT_ID = 'merchant-uuid-0001';
const INTENT_ID = 'intent-uuid-0001';
const TRANSACTION_ID = 'txn-uuid-0001';

describe('billingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PLATFORM_FEE_PERCENT', () => {
    it('is 2%', () => {
      expect(PLATFORM_FEE_PERCENT).toBe(0.02);
    });
  });

  describe('billMerchant', () => {
    const mockInvoice = {
      id: 'invoice-uuid-0001',
      merchantId: MERCHANT_ID,
      intentId: INTENT_ID,
      transactionId: TRANSACTION_ID,
      feeAmount: 0.2,
      feePercent: 0.02,
      currency: 'USDC',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      mockQuery.mockResolvedValue({ rows: [mockInvoice] });
    });

    it('creates an invoice with 2% fee by default', async () => {
      const invoice = await billMerchant({
        merchantId: MERCHANT_ID,
        intentId: INTENT_ID,
        transactionId: TRANSACTION_ID,
        amount: 10,
      });

      expect(invoice.feeAmount).toBe(0.2);
      expect(invoice.merchantId).toBe(MERCHANT_ID);
      expect(mockQuery).toHaveBeenCalledTimes(1);

      // Check the INSERT query includes the right fee
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO merchant_invoices/i);
      expect(params[3]).toBe(0.2); // feeAmount = 10 * 0.02
      expect(params[4]).toBe(0.02); // feePercent
    });

    it('uses custom feePercent when provided', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ ...mockInvoice, feeAmount: 0.05, feePercent: 0.005 }],
      });

      const invoice = await billMerchant({
        merchantId: MERCHANT_ID,
        amount: 10,
        feePercent: 0.005, // 0.5%
      });

      const [, params] = mockQuery.mock.calls[0];
      expect(params[3]).toBe(0.05); // 10 * 0.005
    });

    it('uses USDC as default currency', async () => {
      await billMerchant({ merchantId: MERCHANT_ID, amount: 10 });
      const [, params] = mockQuery.mock.calls[0];
      expect(params[5]).toBe('USDC');
    });

    it('accepts custom currency', async () => {
      await billMerchant({ merchantId: MERCHANT_ID, amount: 10, currency: 'usd' });
      const [, params] = mockQuery.mock.calls[0];
      expect(params[5]).toBe('usd');
    });

    it('accepts null intentId and transactionId', async () => {
      await billMerchant({ merchantId: MERCHANT_ID, amount: 10 });
      const [, params] = mockQuery.mock.calls[0];
      expect(params[1]).toBeNull(); // intentId
      expect(params[2]).toBeNull(); // transactionId
    });
  });

  describe('getMerchantInvoices', () => {
    it('returns invoices for a merchant', async () => {
      const fakeInvoices = [
        { id: 'inv-1', merchantId: MERCHANT_ID, feeAmount: 0.2, status: 'pending' },
        { id: 'inv-2', merchantId: MERCHANT_ID, feeAmount: 0.1, status: 'paid' },
      ];
      mockQuery.mockResolvedValue({ rows: fakeInvoices });

      const invoices = await getMerchantInvoices(MERCHANT_ID);
      expect(invoices).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [MERCHANT_ID, 50, 0]
      );
    });

    it('returns empty array when no invoices exist', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const invoices = await getMerchantInvoices(MERCHANT_ID);
      expect(invoices).toHaveLength(0);
    });

    it('passes limit and offset to the query', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      await getMerchantInvoices(MERCHANT_ID, 10, 20);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        [MERCHANT_ID, 10, 20]
      );
    });
  });
});
