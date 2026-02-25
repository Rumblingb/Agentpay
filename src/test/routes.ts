/**
 * TEST-ONLY routes — never registered in production or staging.
 * Loaded exclusively when NODE_ENV === 'test' && AGENTPAY_TEST_MODE === 'true'.
 *
 * Provides:
 *  POST /api/test/force-verify/:transactionId
 *    Marks a pending transaction as confirmed without calling the Solana RPC,
 *    then fires the merchant's webhook (if configured).
 */
import { Router, Request, Response } from 'express';
import { query } from '../db/index';
import { authenticateApiKey } from '../middleware/auth';
import * as webhooksService from '../services/webhooks';
import * as transactionsService from '../services/transactions';
import type { WebhookPayload } from '../services/webhooks';

const router = Router();

/**
 * Force-marks a pending transaction as confirmed (TEST_MODE only).
 * Authenticated: requires the owning merchant's API key.
 * Fires the merchant webhook payload identical to a real verification.
 */
router.post(
  '/force-verify/:transactionId',
  authenticateApiKey,
  async (req: Request, res: Response) => {
    const merchant = (req as any).merchant!;

    try {
      const tx = await transactionsService.getTransaction(req.params.transactionId);
      if (!tx) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      if (tx.merchantId !== merchant.id) {
        res.status(403).json({ error: 'Unauthorized' });
        return;
      }

      const testHash = `test-tx-${Date.now()}`;
      await query(
        `UPDATE transactions
            SET status              = 'confirmed',
                transaction_hash    = $1,
                confirmation_depth  = required_depth,
                updated_at          = NOW()
          WHERE id = $2`,
        [testHash, req.params.transactionId]
      );

      // Fire the merchant webhook asynchronously (fire-and-forget), matching
      // the same payload shape as a real payment.verified event.
      if (merchant.webhookUrl) {
        const payload: WebhookPayload = {
          event: 'payment.verified',
          transactionId: req.params.transactionId,
          merchantId: merchant.id,
          paymentId: tx.paymentId,
          amountUsdc: tx.amountUsdc,
          recipientAddress: tx.recipientAddress,
          transactionHash: testHash,
          verified: true,
          timestamp: new Date().toISOString(),
        };
        webhooksService
          .scheduleWebhook(merchant.webhookUrl, payload, merchant.id, req.params.transactionId)
          .catch((err) => {
            // Log scheduling errors for test debugging; do not fail the response.
            console.error('[TEST] Webhook scheduling error:', err);
          });
      }

      res.json({ success: true, status: 'confirmed', transactionId: req.params.transactionId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
