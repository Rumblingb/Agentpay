import { Router, Request, Response } from 'express';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import * as merchantsService from '../services/merchants';
import * as transactionsService from '../services/transactions';
import * as webhooksService from '../services/webhooks';
import type { WebhookPayload } from '../services/webhooks';
import * as webhookEmitter from '../services/webhookEmitter';
import * as auditService from '../services/audit';
import { signCertificate } from '../services/certificateService';
import { billMerchant } from '../services/billingService';
import { query } from '../db/index';
import { authenticateApiKey } from '../middleware/auth';
import { logger } from '../logger';

const router = Router();

/** Builds the standard payload for a payment.verified webhook event. */
function buildPaymentVerifiedPayload(
  transactionId: string,
  merchantId: string,
  tx: transactionsService.Transaction,
  payerAddress: string | undefined,
  transactionHash: string
): WebhookPayload {
  return {
    event: 'payment.verified',
    transactionId,
    merchantId,
    paymentId: tx.paymentId,
    amountUsdc: tx.amountUsdc,
    recipientAddress: tx.recipientAddress,
    payerAddress,
    transactionHash,
    verified: true,
    timestamp: new Date().toISOString(),
  };
}

// Tighter rate limit for sensitive write operations (e.g., key rotation)
const sensitiveOpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests for this operation, please try again later.' },
});

const registerSchema = Joi.object({
  name: Joi.string().min(3).max(255).required(),
  email: Joi.string().email().required(),
  walletAddress: Joi.string().min(32).max(44).required(),
  webhookUrl: Joi.string().uri().optional(),
});

const paymentSchema = Joi.object({
  amountUsdc: Joi.number().positive().required(),
  recipientAddress: Joi.string().min(32).max(44).required(),
  metadata: Joi.object().optional(),
  expiryMinutes: Joi.number().min(1).max(1440).optional(),
});

const verifyPaymentSchema = Joi.object({
  transactionHash: Joi.string().required(),
});

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d) => d.message),
      });
      return;
    }

    const { merchantId, apiKey } = await merchantsService.registerMerchant(
      value.name,
      value.email,
      value.walletAddress,
      value.webhookUrl
    );

    logger.info('New merchant registered', { merchantId, email: value.email });

    res.status(201).json({
      success: true,
      merchantId,
      apiKey,
      message: 'Store your API key securely. You will not be able to view it again.',
    });
  } catch (error: any) {
    logger.error('Registration error:', error);
    res.status(400).json({ error: error.message });
  }
});

router.get('/profile', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const merchant = await merchantsService.getMerchant((req as any).merchant!.id);
    if (!merchant) {
      res.status(404).json({ error: 'Merchant not found' });
      return;
    }
    res.json({
      id: merchant.id,
      name: merchant.name,
      email: merchant.email,
      walletAddress: merchant.walletAddress,
      createdAt: merchant.createdAt,
    });
  } catch (error: any) {
    logger.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.post('/payments', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { error, value } = paymentSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d) => d.message),
      });
      return;
    }

    const { transactionId, paymentId } = await transactionsService.createPaymentRequest(
      (req as any).merchant!.id,
      value.amountUsdc,
      value.recipientAddress,
      value.metadata,
      value.expiryMinutes || 30
    );

    logger.info('Payment request created', {
      merchantId: (req as any).merchant!.id,
      paymentId,
      amount: value.amountUsdc,
    });

    res.status(201).json({
      success: true,
      transactionId,
      paymentId,
      amount: value.amountUsdc,
      recipientAddress: value.recipientAddress,
      instructions: 'Send USDC to the recipient address within the expiry time',
    });
  } catch (error: any) {
    logger.error('Payment creation error:', error);
    res.status(400).json({ error: error.message });
  }
});

router.post('/payments/:transactionId/verify', authenticateApiKey, async (req: Request, res: Response) => {
  const merchant = (req as any).merchant!;
  const ipAddress = req.ip ?? req.socket.remoteAddress ?? null;

  try {
    const { error, value } = verifyPaymentSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d) => d.message),
      });
      return;
    }

    const tx = await transactionsService.getTransaction(req.params.transactionId);
    if (!tx) {
      await auditService.logVerifyAttempt({
        merchantId: merchant.id,
        ipAddress,
        transactionSignature: value.transactionHash,
        transactionId: req.params.transactionId,
        endpoint: req.path,
        method: req.method,
        succeeded: false,
        failureReason: 'Transaction not found',
      });
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }

    if (tx.merchantId !== merchant.id) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const verification = await transactionsService.verifyAndUpdatePayment(
      req.params.transactionId,
      value.transactionHash
    );

    // Audit log — always record outcome regardless of success/failure
    await auditService.logVerifyAttempt({
      merchantId: merchant.id,
      ipAddress,
      transactionSignature: value.transactionHash,
      transactionId: req.params.transactionId,
      endpoint: req.path,
      method: req.method,
      succeeded: verification.success,
      failureReason: verification.success ? null : verification.error ?? null,
    });

    if (!verification.success) {
      logger.warn('[SECURITY] Payment verification failed', {
        transactionId: req.params.transactionId,
        error: verification.error,
      });

      res.status(400).json({
        success: false,
        error: verification.error,
      });
      return;
    }

    logger.info('Payment verified successfully', {
      transactionId: req.params.transactionId,
      verified: verification.verified,
    });

    // Sign a verification certificate on confirmed payment
    let certificate: string | undefined;
    if (verification.verified) {
      try {
        certificate = signCertificate({
          transactionId: req.params.transactionId,
          merchantId: merchant.id,
          amountUsdc: tx.amountUsdc,
          transactionHash: value.transactionHash,
          payer: verification.payer,
          verifiedAt: new Date().toISOString(),
        });

        // Persist certificate to DB (fire-and-forget; non-critical)
        query(
          `INSERT INTO verification_certificates (id, intent_id, payload, signature, encoded)
           VALUES (gen_random_uuid(), NULL, $1, $2, $3)`,
          [
            JSON.stringify({ transactionId: req.params.transactionId }),
            certificate.slice(0, 64),
            certificate,
          ]
        ).catch((err) => logger.error('Certificate persist error', { err }));
      } catch (certErr: any) {
        logger.warn('Certificate signing skipped (VERIFICATION_SECRET not set?)', { error: certErr.message });
      }
    }

    // Bill merchant 2% SaaS fee (fire-and-forget)
    if (verification.verified) {
      billMerchant({
        merchantId: merchant.id,
        transactionId: req.params.transactionId,
        amount: tx.amountUsdc ?? 0,
      }).catch((err) => logger.error('Billing error', { err }));
    }

    // Fire legacy webhook asynchronously — non-blocking, never fails the response
    if (merchant.webhookUrl && verification.verified) {
      const payload = buildPaymentVerifiedPayload(
        req.params.transactionId,
        merchant.id,
        tx,
        verification.payer,
        value.transactionHash
      );
      webhooksService.scheduleWebhook(
        merchant.webhookUrl,
        payload,
        merchant.id,
        req.params.transactionId
      ).catch((err) => logger.error('Webhook scheduling error', { err }));
    }

    // Fire V2 subscription webhooks asynchronously
    if (verification.verified) {
      webhookEmitter.emitPaymentVerified(merchant.id, {
        type: 'payment_verified',
        intentId: req.params.transactionId,
        txHash: value.transactionHash,
        amount: tx.amountUsdc ?? 0,
        certificate,
      }).catch((err) => logger.error('V2 webhook emitter error', { err }));
    }

    res.json({
      success: true,
      verified: verification.verified,
      payer: verification.payer,
      certificate,
      message: verification.verified ? 'Payment confirmed!' : 'Payment detected but pending confirmations',
    });
  } catch (error: any) {
    // Audit failed verification
    await auditService.logVerifyAttempt({
      merchantId: merchant.id,
      ipAddress,
      transactionSignature: req.body?.transactionHash ?? null,
      transactionId: req.params.transactionId,
      endpoint: req.path,
      method: req.method,
      succeeded: false,
      failureReason: error?.message ?? 'Unknown error',
    });
    logger.error('Payment verification error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/payments/:transactionId', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const tx = await transactionsService.getTransaction(req.params.transactionId);
    if (!tx) {
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }

    if (tx.merchantId !== (req as any).merchant!.id) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    res.json(tx);
  } catch (error: any) {
    logger.error('Transaction fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/payments', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const transactions = await transactionsService.getMerchantTransactions(
      (req as any).merchant!.id,
      limit,
      offset
    );

    const stats = await transactionsService.getMerchantStats((req as any).merchant!.id);

    res.json({
      success: true,
      transactions,
      stats,
      pagination: { limit, offset },
    });
  } catch (error: any) {
    logger.error('Transactions list error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const stats = await transactionsService.getMerchantStats((req as any).merchant!.id);
    res.json({
      success: true,
      ...stats,
    });
  } catch (error: any) {
    logger.error('Stats fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/rotate-key', sensitiveOpLimiter, authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { apiKey: newKey } = await merchantsService.rotateApiKey((req as any).merchant!.id);

    logger.info('API key rotated', { merchantId: (req as any).merchant!.id });

    res.json({
      success: true,
      apiKey: newKey,
      message: 'Please store this key securely. It will not be shown again.',
    });
  } catch (error: any) {
    logger.error('Key rotation error:', error);
    res.status(500).json({ error: 'Failed to rotate API key' });
  }
});

router.get('/invoices', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { getMerchantInvoices } = await import('../services/billingService');
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const invoices = await getMerchantInvoices((req as any).merchant!.id, limit, offset);
    res.json({ success: true, invoices, pagination: { limit, offset } });
  } catch (error: any) {
    logger.error('Invoices fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/stripe/connect', sensitiveOpLimiter, authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const merchant = (req as any).merchant!;
    const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
    const returnUrl = req.body.returnUrl || `${baseUrl}/api/stripe/onboard/return`;
    const refreshUrl = req.body.refreshUrl || `${baseUrl}/api/stripe/onboard/refresh`;

    const { createConnectOnboardingLink } = await import('../services/stripeService');
    const { url, accountId } = await createConnectOnboardingLink(
      merchant.id,
      merchant.email,
      returnUrl,
      refreshUrl
    );

    logger.info('Stripe Connect onboarding initiated', { merchantId: merchant.id, accountId });

    res.status(200).json({
      success: true,
      onboardingUrl: url,
      stripeAccountId: accountId,
    });
  } catch (error: any) {
    logger.error('Stripe Connect error:', error);
    res.status(500).json({ error: error.message || 'Failed to create Stripe Connect onboarding link' });
  }
});

export default router;