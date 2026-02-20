import { Router, Request, Response } from 'express';
import Joi from 'joi';
import * as merchantsService from '../services/merchants';
import * as transactionsService from '../services/transactions';
import { authenticateApiKey } from '../middleware/auth';
import { logger } from '../logger';

const router = Router();

const registerSchema = Joi.object({
  name: Joi.string().min(3).max(255).required(),
  email: Joi.string().email().required(),
  walletAddress: Joi.string().min(32).max(44).required(),
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
      value.walletAddress
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
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }

    if (tx.merchantId !== (req as any).merchant!.id) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const verification = await transactionsService.verifyAndUpdatePayment(
      req.params.transactionId,
      value.transactionHash
    );

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

    res.json({
      success: true,
      verified: verification.verified,
      payer: verification.payer,
      message: verification.verified ? 'Payment confirmed!' : 'Payment detected but pending confirmations',
    });
  } catch (error: any) {
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

export default router;