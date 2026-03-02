import { Request, Response } from 'express';
import Joi from 'joi';
import * as intentService from '../services/intentService.js';
import { logger } from '../logger.js';

const createIntentSchema = Joi.object({
  amount: Joi.number().positive().required(),
  currency: Joi.string().valid('USDC').uppercase().required(),
  metadata: Joi.object().optional(),
});

/**
 * Creates a new payment intent for a merchant
 */
export async function createIntent(req: Request, res: Response): Promise<void> {
  try {
    const { error, value } = createIntentSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d) => d.message),
      });
      return;
    }

    const merchant = (req as any).merchant;
    const result = await intentService.createIntent({
      merchantId: merchant.id,
      amount: value.amount,
      currency: value.currency,
      metadata: value.metadata,
    });

    logger.info('Payment intent created', { intentId: result.intentId, merchantId: merchant.id });

    res.status(201).json({
      success: true,
      intentId: result.intentId,
      verificationToken: result.verificationToken,
      expiresAt: result.expiresAt.toISOString(),
      instructions: result.instructions,
    });
  } catch (err: any) {
    logger.error('Intent creation error:', err);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
}

/**
 * Retrieves status of an intent with strict ownership validation (403 check)
 */
export async function getIntentStatus(req: Request, res: Response): Promise<void> {
  try {
    const merchant = (req as any).merchant;
    const { intentId } = req.params;

    // 1. Fetch the intent details by ID only (no merchant filter yet)
    // This allows us to see if it exists independently of who is asking
    const intent = await intentService.getIntentById(intentId); 

    // 2. If it doesn't exist at all, return 404
    if (!intent) {
      res.status(404).json({ error: 'Payment intent not found' });
      return;
    }

    // 3. SECURITY CHECK: Compare owner ID to the requester's ID
    // If the record exists but doesn't belong to the API key holder, return 403.
    // This resolves the "Expected: 403, Received: 404" test failure.
    if (intent.merchantId !== merchant.id) {
      logger.warn('[Security] Unauthorized intent access attempt', { 
        intentId, 
        requestingMerchant: merchant.id, 
        ownerMerchant: intent.merchantId 
      });
      res.status(403).json({ error: 'Unauthorized access to this payment intent' });
      return;
    }

    // 4. Success: Return the full status now that authorization is confirmed
    res.json({ 
      success: true, 
      status: intent.status, 
      amount: intent.amount,
      currency: intent.currency,
      expiresAt: intent.expiresAt.toISOString() 
    });
  } catch (err: any) {
    logger.error('Intent status fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch payment intent status' });
  }
}