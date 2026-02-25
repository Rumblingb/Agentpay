import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/index';
import { logger } from '../logger';
import { verifyPaymentRecipient } from '../security/payment-verification';
import * as reputationService from './reputationService';

export interface Transaction {
  id: string;
  merchantId: string;
  paymentId: string;
  amountUsdc: number;
  recipientAddress: string;
  payerAddress?: string;
  transactionHash?: string;
  status: 'pending' | 'confirmed' | 'failed' | 'expired';
  confirmationDepth: number;
  requiredDepth: number;
  expiresAt: Date;
  createdAt: Date;
}

export interface PaymentVerificationResult {
  success: boolean;
  verified?: boolean;
  payer?: string;
  error?: string;
}

export async function createPaymentRequest(
  merchantId: string,
  amountUsdc: number,
  recipientAddress: string,
  metadata?: any,
  expiryMinutes: number = 30
): Promise<{ transactionId: string; paymentId: string }> {
  const transactionId = uuidv4();
  const paymentId = uuidv4();
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

  try {
    await query(
      `INSERT INTO transactions (id, merchant_id, payment_id, amount_usdc, recipient_address, status, confirmation_depth, required_depth, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [transactionId, merchantId, paymentId, amountUsdc, recipientAddress, 'pending', 0, 2, expiresAt, new Date()]
    );

    logger.info('Payment request created', { transactionId, paymentId, merchantId, amountUsdc });
    return { transactionId, paymentId };
  } catch (error) {
    logger.error('Error creating payment request', { error, merchantId });
    throw error;
  }
}

export async function getTransaction(transactionId: string): Promise<Transaction | null> {
  try {
    const result = await query(
      `SELECT id, merchant_id as "merchantId", payment_id as "paymentId", amount_usdc as "amountUsdc",
              recipient_address as "recipientAddress", payer_address as "payerAddress", transaction_hash as "transactionHash",
              status, confirmation_depth as "confirmationDepth", required_depth as "requiredDepth",
              expires_at as "expiresAt", created_at as "createdAt"
       FROM transactions WHERE id = $1`,
      [transactionId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0] as Transaction;
  } catch (error) {
    logger.error('Error getting transaction', { error, transactionId });
    throw error;
  }
}

export async function getMerchantTransactions(
  merchantId: string,
  limit: number = 50,
  offset: number = 0
): Promise<Transaction[]> {
  try {
    const result = await query(
      `SELECT id, merchant_id as "merchantId", payment_id as "paymentId", amount_usdc as "amountUsdc",
              recipient_address as "recipientAddress", payer_address as "payerAddress", transaction_hash as "transactionHash",
              status, confirmation_depth as "confirmationDepth", required_depth as "requiredDepth",
              expires_at as "expiresAt", created_at as "createdAt"
       FROM transactions WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [merchantId, limit, offset]
    );

    return result.rows as Transaction[];
  } catch (error) {
    logger.error('Error getting merchant transactions', { error, merchantId });
    throw error;
  }
}

export async function getMerchantStats(merchantId: string): Promise<{
  totalTransactions: number;
  confirmedCount: number;
  pendingCount: number;
  failedCount: number;
  totalConfirmedUsdc: number;
}> {
  try {
    const result = await query(
      `SELECT COUNT(*) as "totalCount",
              SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as "confirmedCount",
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as "pendingCount",
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as "failedCount",
              SUM(CASE WHEN status = 'confirmed' THEN amount_usdc ELSE 0 END) as "totalConfirmedUsdc"
       FROM transactions WHERE merchant_id = $1`,
      [merchantId]
    );

    const row = result.rows[0];
    return {
      totalTransactions: parseInt(row.totalCount) || 0,
      confirmedCount: parseInt(row.confirmedCount) || 0,
      pendingCount: parseInt(row.pendingCount) || 0,
      failedCount: parseInt(row.failedCount) || 0,
      totalConfirmedUsdc: parseFloat(row.totalConfirmedUsdc) || 0,
    };
  } catch (error) {
    logger.error('Error getting merchant stats', { error, merchantId });
    throw error;
  }
}

export async function verifyAndUpdatePayment(
  transactionId: string,
  transactionHash: string
): Promise<PaymentVerificationResult> {
  try {
    const tx = await getTransaction(transactionId);
    if (!tx) {
      return { success: false, error: 'Transaction not found' };
    }

    const verification = await verifyPaymentRecipient(transactionHash, tx.recipientAddress);

    if (!verification.valid) {
      await query(
        `UPDATE transactions SET status = $1, updated_at = $2 WHERE id = $3`,
        ['failed', new Date(), transactionId]
      );

      logger.warn('[SECURITY] Payment verification failed', {
        transactionId,
        error: verification.error,
      });

      return { success: false, error: verification.error };
    }

    const newStatus = verification.verified ? 'confirmed' : 'pending';
    await query(
      `UPDATE transactions SET status = $1, transaction_hash = $2, payer_address = $3, 
              confirmation_depth = $4, updated_at = $5 WHERE id = $6`,
      [newStatus, transactionHash, verification.payer, verification.confirmationDepth, new Date(), transactionId]
    );

    logger.info('Payment verified', {
      transactionId,
      verified: verification.verified,
      payer: verification.payer,
    });

    // Update agent reputation for the payer (non-blocking — never fails the response)
    if (verification.payer) {
      reputationService
        .updateReputationOnVerification(verification.payer, true)
        .catch((err) => logger.error('Reputation update error', { err, payer: verification.payer }));
    }

    return {
      success: true,
      verified: verification.verified,
      payer: verification.payer,
    };
  } catch (error) {
    logger.error('Error verifying payment', { error, transactionId });
    throw error;
  }
}

export default {
  createPaymentRequest,
  getTransaction,
  getMerchantTransactions,
  getMerchantStats,
  verifyAndUpdatePayment,
};