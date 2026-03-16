import { query } from '../db/index.js';
import { logger } from '../logger.js';

export const PLATFORM_FEE_PERCENT = 0.02; // 2% SaaS fee

export interface MerchantInvoice {
  id: string;
  merchantId: string;
  intentId: string | null;
  transactionId: string | null;
  feeAmount: number;
  feePercent: number;
  currency: string;
  status: 'pending' | 'paid' | 'waived';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Creates a platform-fee invoice for a successfully verified payment.
 * Fee = feePercent * amount (default 2%).
 */
export async function billMerchant(params: {
  merchantId: string;
  intentId?: string | null;
  transactionId?: string | null;
  amount: number;
  currency?: string;
  feePercent?: number;
}): Promise<MerchantInvoice> {
  const {
    merchantId,
    intentId = null,
    transactionId = null,
    amount,
    currency = 'USDC',
    feePercent = PLATFORM_FEE_PERCENT,
  } = params;

  const feeAmount = parseFloat((amount * feePercent).toFixed(6));

  const result = await query(
    `INSERT INTO merchant_invoices
       (merchant_id, intent_id, transaction_id, fee_amount, fee_percent, currency, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING id, merchant_id as "merchantId", intent_id as "intentId",
               transaction_id as "transactionId", fee_amount as "feeAmount",
               fee_percent as "feePercent", currency, status,
               created_at as "createdAt", updated_at as "updatedAt"`,
    [merchantId, intentId, transactionId, feeAmount, feePercent, currency]
  );

  const invoice = result.rows[0] as MerchantInvoice;

  logger.info('Merchant invoice created', {
    merchantId,
    invoiceId: invoice.id,
    feeAmount,
    feePercent,
    currency,
  });

  return invoice;
}

/**
 * Returns all invoices for a merchant, newest first.
 */
export async function getMerchantInvoices(
  merchantId: string,
  limit = 50,
  offset = 0
): Promise<MerchantInvoice[]> {
  const result = await query(
    `SELECT id, merchant_id as "merchantId", intent_id as "intentId",
            transaction_id as "transactionId", fee_amount as "feeAmount",
            fee_percent as "feePercent", currency, status,
            created_at as "createdAt", updated_at as "updatedAt"
     FROM merchant_invoices
     WHERE merchant_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [merchantId, limit, offset]
  );
  return result.rows as MerchantInvoice[];
}

export default { billMerchant, getMerchantInvoices, PLATFORM_FEE_PERCENT };
