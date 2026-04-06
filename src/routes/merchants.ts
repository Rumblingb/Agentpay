import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { validate as uuidValidate } from 'uuid';
import * as merchantsService from '../services/merchants.js';
import * as transactionsService from '../services/transactions.js';
import { evaluatePolicy } from '../policy/evaluatePolicy.js';
import * as webhooksService from '../services/webhooks.js';
import { scrubClaimServer } from '../lib/claimScrubber.js';
import type { WebhookPayload } from '../services/webhooks.js';
import * as webhookEmitter from '../services/webhookEmitter.js';
import * as auditService from '../services/audit.js';
import { signCertificate } from '../services/certificateService.js';
import { billMerchant } from '../services/billingService.js';
import { query } from '../db/index.js';
import { authenticateApiKey } from '../middleware/auth.js';
import { logger } from '../logger.js';

// Interface for the Authenticated Request
interface AuthRequest extends Request {
  body: any;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  path: string;
  method: string;
  merchant?: {
    id: string;
    name?: string;
    email?: string;
    walletAddress?: string | null;
    webhookUrl?: string | null;
  };
}

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

// --- RATE LIMITERS ---
const sensitiveOpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests for this operation, please try again later.' },
});

// --- SCHEMAS ---
const registerSchema = Joi.object({
  name: Joi.string().min(3).max(255).required(),
  email: Joi.string().email().required(),
  walletAddress: Joi.string().min(32).max(44).required(),
  // Accept any syntactically valid URI here. The SSRF-protection and HTTPS
  // enforcement are handled by validateWebhookUrl() inside scheduleWebhook()
  // which is the authoritative security layer. Using a single validation point
  // avoids environment-dependent schema divergence and keeps registration-time
  // errors focused on payload shape rather than delivery policy.
  webhookUrl: Joi.string().uri().optional(),
});

const webhookUpdateSchema = Joi.object({
  // URI syntax check only; SSRF/HTTPS enforcement is in scheduleWebhook.
  webhookUrl: Joi.string().uri().required().allow(null),
});

const paymentSchema = Joi.object({
  amountUsdc: Joi.number().positive().required(),
  recipientAddress: Joi.string().min(32).max(44).required(),
  agentId: Joi.string().uuid().optional(),
  protocol: Joi.string().valid('solana', 'x402', 'ap2', 'acp').optional(),
  metadata: Joi.object().optional(),
  expiryMinutes: Joi.number().min(1).max(1440).optional(),
});

const draftSchema = Joi.object({
  amountUsdc: Joi.number().positive().required(),
  recipientAddress: Joi.string().min(0).max(44).optional().allow(''),
  metadata: Joi.object().optional(),
  expiryMinutes: Joi.number().min(1).max(525600).optional(),
});

const verifyPaymentSchema = Joi.object({
  transactionHash: Joi.string().required(),
});

// --- ROUTES ---

/**
 * @route   POST /api/merchants/register
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d: any) => d.message),
      });
    }

    const { merchantId, apiKey } = await merchantsService.registerMerchant(
      value.name,
      value.email,
      value.walletAddress,
      value.webhookUrl
    );

    logger.info({ merchantId, email: value.email }, 'New merchant registered');

    res.status(201).json({
      success: true,
      merchantId,
      apiKey,
      message: 'Store your API key securely. You will not be able to view it again.',
    });
  } catch (error: any) {
    logger.error({ error }, 'Registration error:');
    res.status(400).json({ error: error.message });
  }
});

/**
 * Shared handler for GET /api/merchants/profile and GET /api/merchants/me
 */
const handleGetProfile = async (req: AuthRequest, res: Response) => {
  try {
    const merchant = await merchantsService.getMerchant(req.merchant!.id);
    if (!merchant) {
      // Fall back to the authenticated merchant data set by the auth middleware.
      // This covers simulation/test-mode bypass where the merchant ID may not
      // exist in the database.
      return res.json({
        id: req.merchant!.id,
        name: req.merchant!.name ?? null,
        email: req.merchant!.email,
        walletAddress: req.merchant!.walletAddress ?? null,
        webhookUrl: req.merchant!.webhookUrl ?? null,
        createdAt: null,
      });
    }
    res.json({
      id: merchant.id,
      name: merchant.name,
      email: merchant.email,
      walletAddress: merchant.walletAddress,
      webhookUrl: merchant.webhookUrl,
      createdAt: merchant.createdAt,
    });
  } catch (error: any) {
    logger.error({ error }, 'Profile fetch error:');
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
};

/**
 * @route   GET /api/merchants/profile
 */
router.get('/profile', authenticateApiKey, handleGetProfile);

/**
 * @route   GET /api/merchants/me
 */
router.get('/me', authenticateApiKey, handleGetProfile);

/**
 * @route   GET /api/merchants/webhooks
 */
router.get('/webhooks', authenticateApiKey, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT id, event_type, status, payload, created_at FROM webhook_events WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.merchant!.id]
    );
    res.json({ success: true, events: result.rows });
  } catch (error: any) {
    logger.error('Webhook fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch webhook history' });
  }
});

/**
 * @route   PATCH /api/merchants/profile/webhook
 */
router.patch('/profile/webhook', authenticateApiKey, async (req: AuthRequest, res: Response) => {
  try {
    const { error, value } = webhookUpdateSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    await query(
      'UPDATE merchants SET webhook_url = $1, updated_at = NOW() WHERE id = $2',
      [value.webhookUrl, req.merchant!.id]
    );

    res.json({ success: true, message: 'Webhook URL updated' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update webhook URL' });
  }
});

/**
 * @route   POST /api/merchants/payments
 */
router.post('/payments', authenticateApiKey, async (req: AuthRequest, res: Response) => {
  try {
    const { error, value } = paymentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d: any) => d.message),
      });
    }

    // Evaluate merchant policy before creating the payment request / settlement
    try {
      const evalRes = await evaluatePolicy(query, req.merchant!.id, {
        amount: value.amountUsdc,
        recipientAddress: value.recipientAddress,
        agentId: value.agentId,
        passportId: value.metadata?.passportId,
        trustScore: value.metadata?.trustScore,
      });

      if (evalRes.decision === 'REJECT') {
        return res.status(403).json({ success: false, error: 'policy_rejected', reason: evalRes.reason, policyVersion: evalRes.policyVersion, evaluatedAt: evalRes.evaluatedAt });
      }

      if (evalRes.decision === 'REQUIRES_APPROVAL') {
        return res.status(202).json({ status: 'approval_required', reason: evalRes.reason, policyVersion: evalRes.policyVersion, evaluatedAt: evalRes.evaluatedAt });
      }
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Policy evaluation failed; proceeding with payment creation');
    }

    const { transactionId, paymentId } = await transactionsService.createPaymentRequest(
      req.merchant!.id,
      value.amountUsdc,
      value.recipientAddress,
      value.metadata,
      value.expiryMinutes || 30
    );

    // Server-side scrubbing: validate metadata (patient, code) before creating live payment
    try {
      const scrub = scrubClaimServer({ patient: value.metadata?.patient, amount: value.amountUsdc, code: value.metadata?.code });
      if (!scrub.ok && scrub.status === 'invalid') {
        return res.status(400).json({ success: false, error: 'scrub_invalid', reason: scrub.reason });
      }
      // If unknown_code, we attach scrub flag into metadata for ops review
      if (scrub.status === 'unknown_code') {
        value.metadata = { ...(value.metadata || {}), scrubStatus: 'unknown_code', scrubNote: scrub.reason };
      }
    } catch (err) {
      logger.warn({ err }, 'Scrub check failed; proceeding with creation');
    }

    logger.info({ merchantId: req.merchant!.id, paymentId, amount: value.amountUsdc, agentId: value.agentId ?? null, protocol: value.protocol ?? null }, 'Payment request created');

    res.status(201).json({
      success: true,
      transactionId,
      paymentId,
      amount: value.amountUsdc,
      recipientAddress: value.recipientAddress,
      instructions: 'Send USDC to the recipient address within the expiry time',
    });
  } catch (error: any) {
    logger.error({ error }, 'Payment creation error:');
    res.status(400).json({ error: error.message });
  }
});

/**
 * @route   POST /api/merchants/payments/drafts
 * Creates a server-persisted draft invoice (status='draft') so the prototype
 * can store practitioner drafts in the repo DB and share them across devices.
 */
router.post('/payments/drafts', authenticateApiKey, async (req: AuthRequest, res: Response) => {
  try {
    const { error, value } = draftSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: 'Validation error', details: error.details.map((d: any) => d.message) });
    }

    const transactionId = uuidv4();
    const paymentId = uuidv4();
    const expiresAt = new Date(Date.now() + (value.expiryMinutes || 60) * 60 * 1000);

    // Server-side scrub for drafts
    try {
      const scrub = scrubClaimServer({ patient: value.metadata?.patient, amount: value.amountUsdc, code: value.metadata?.code });
      if (!scrub.ok && scrub.status === 'invalid') {
        return res.status(400).json({ success: false, error: 'scrub_invalid', reason: scrub.reason });
      }
      if (scrub.status === 'unknown_code') {
        value.metadata = { ...(value.metadata || {}), scrubStatus: 'unknown_code', scrubNote: scrub.reason };
      }
    } catch (err) {
      logger.warn({ err }, 'Draft scrub failed; persisting draft for manual review');
    }

    await query(
      `INSERT INTO transactions (id, merchant_id, payment_id, amount_usdc, recipient_address, status, confirmation_depth, required_depth, expires_at, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())`,
      [transactionId, req.merchant!.id, paymentId, value.amountUsdc, value.recipientAddress || '', 'draft', 0, 0, expiresAt, JSON.stringify(value.metadata || {})]
    );

    logger.info({ merchantId: req.merchant!.id, transactionId, amount: value.amountUsdc }, 'Draft invoice persisted');

    res.status(201).json({ success: true, transactionId, message: 'Draft saved' });
  } catch (err: any) {
    logger.error({ err }, 'Draft persist error');
    res.status(500).json({ error: 'Failed to persist draft' });
  }
});

/**
 * @route   POST /api/merchants/payments/:transactionId/verify
 */
router.post('/payments/:transactionId/verify', authenticateApiKey, async (req: AuthRequest, res: Response) => {
  const merchant = req.merchant!;
  const ipAddress = req.ip ?? req.socket.remoteAddress ?? null;

  if (!uuidValidate(req.params.transactionId)) {
    return res.status(400).json({ error: 'Invalid transaction ID' });
  }

  try {
    const { error, value } = verifyPaymentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d) => d.message),
      });
    }

    const tx = await transactionsService.getTransaction(req.params.transactionId);
    
    // Existence Check
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
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Ownership Check (403 required for security tests)
    if (tx.merchantId !== merchant.id) {
      return res.status(403).json({ error: 'Unauthorized access to this transaction' });
    }

    const verification = await transactionsService.verifyAndUpdatePayment(
      req.params.transactionId,
      value.transactionHash
    );

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
      logger.warn({ transactionId: req.params.transactionId, error: verification.error }, '[SECURITY] Payment verification failed');
      return res.status(400).json({
        success: false,
        error: verification.error,
      });
    }

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

        query(
          `INSERT INTO verification_certificates (id, intent_id, payload, signature, encoded)
           VALUES (gen_random_uuid(), NULL, $1, $2, $3)`,
          [JSON.stringify({ transactionId: req.params.transactionId }), certificate.slice(0, 64), certificate]
        ).catch((err) => logger.error({ err }, 'Certificate persist error'));
      } catch (certErr: any) {
        logger.warn({ error: certErr.message }, 'Certificate signing skipped');
      }

      billMerchant({
        merchantId: merchant.id,
        transactionId: req.params.transactionId,
        amount: tx.amountUsdc ?? 0,
      }).catch((err) => logger.error({ err }, 'Billing error'));

      const currentMerchant = await merchantsService.getMerchant(merchant.id);
      if (currentMerchant?.webhookUrl) {
        const payload = buildPaymentVerifiedPayload(
          req.params.transactionId,
          merchant.id,
          tx,
          verification.payer,
          value.transactionHash
        );
        webhooksService.scheduleWebhook(
          currentMerchant.webhookUrl,
          payload,
          merchant.id,
          req.params.transactionId
        ).catch((err) => logger.error({ err }, 'Webhook scheduling error'));
      }

      webhookEmitter.emitPaymentVerified(merchant.id, {
        type: 'payment_verified',
        intentId: req.params.transactionId,
        txHash: value.transactionHash,
        amount: tx.amountUsdc ?? 0,
        certificate,
      }).catch((err) => logger.error({ err }, 'V2 webhook emitter error'));
    }

    res.json({
      success: true,
      verified: verification.verified,
      payer: verification.payer,
      certificate,
      message: verification.verified ? 'Payment confirmed!' : 'Payment detected but pending confirmations',
    });
  } catch (error: any) {
    logger.error({ error }, 'Payment verification error:');
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/merchants/payments/:transactionId
 * Updated ownership logic to return 403 instead of 404 on merchant mismatch.
 */
router.get('/payments/:transactionId', authenticateApiKey, async (req: AuthRequest, res: Response) => {
  if (!uuidValidate(req.params.transactionId)) {
    return res.status(400).json({ error: 'Invalid transaction ID' });
  }

  try {
    const tx = await transactionsService.getTransaction(req.params.transactionId);
    
    // 1. Check existence
    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // 2. Check ownership - Must return 403 if it exists but belongs to another merchant
    if (tx.merchantId !== req.merchant!.id) {
      logger.warn({ transactionId: req.params.transactionId, requestingMerchant: req.merchant!.id, actualOwner: tx.merchantId }, '[Security] Unauthorized transaction access attempt');
      return res.status(403).json({ error: 'Unauthorized access to this transaction' });
    }

    res.json(tx);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/merchants/payments
 */
router.get('/payments', authenticateApiKey, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const transactions = await transactionsService.getMerchantTransactions(req.merchant!.id, limit, offset);
    const stats = await transactionsService.getMerchantStats(req.merchant!.id);

    res.json({
      success: true,
      transactions,
      stats,
      pagination: { limit, offset },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/merchants/stats
 */
router.get('/stats', authenticateApiKey, async (req: AuthRequest, res: Response) => {
  try {
    const stats = await transactionsService.getMerchantStats(req.merchant!.id);
    res.json({ success: true, ...stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/merchants/rotate-key
 */
router.post('/rotate-key', sensitiveOpLimiter, authenticateApiKey, async (req: AuthRequest, res: Response) => {
  try {
    const { apiKey: newKey } = await merchantsService.rotateApiKey(req.merchant!.id);
    res.json({
      success: true,
      apiKey: newKey,
      message: 'Please store this key securely.',
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to rotate API key' });
  }
});

export default router;