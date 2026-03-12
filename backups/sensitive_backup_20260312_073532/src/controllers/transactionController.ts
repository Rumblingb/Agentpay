import { Request, Response } from 'express';
import * as transactionService from '../services/transactions.js';
import { logger } from '../logger.js';

/**
 * GET /api/v1/transactions/:transactionId
 * Strictly enforced ownership check to pass security integration tests.
 */
export async function getTransactionDetails(req: Request, res: Response): Promise<void> {
  try {
    const { transactionId } = req.params;
    const merchant = (req as any).merchant; // Populated by your auth middleware

    // 1. Fetch by ID ONLY (Service must not filter by merchantId here)
    const tx = await transactionService.getTransaction(transactionId);

    // 2. If it doesn't exist in the database at all -> 404
    if (!tx) {
      res.status(404).json({ 
        success: false, 
        error: 'Transaction not found' 
      });
      return;
    }

    // 3. THE CRITICAL CHECK: Does the transaction belong to the requesting merchant?
    // If NO, return 403. This is what changes your test result from FAIL to PASS.
    if (tx.merchantId !== merchant.id) {
      logger.warn('[Security] Unauthorized transaction access attempt blocked', {
        transactionId,
        requestingMerchant: merchant.id,
        actualOwner: tx.merchantId
      });
      
      res.status(403).json({ 
        success: false, 
        error: 'Forbidden: You do not have access to this transaction' 
      });
      return;
    }

    // 4. Success -> 200
    res.json({
      success: true,
      transaction: tx
    });
  } catch (err: any) {
    logger.error('Error in getTransactionDetails:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/v1/transactions
 */
export async function listMerchantTransactions(req: Request, res: Response): Promise<void> {
  try {
    const merchant = (req as any).merchant;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const transactions = await transactionService.getMerchantTransactions(
      merchant.id,
      limit,
      offset
    );

    res.json({
      success: true,
      count: transactions.length,
      transactions
    });
  } catch (err: any) {
    logger.error('List transactions error:', err);
    res.status(500).json({ error: 'Failed to retrieve transactions' });
  }
}