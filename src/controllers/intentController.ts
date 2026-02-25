import { Request, Response } from 'express';
import Joi from 'joi';
import * as intentService from '../services/intentService';
import { logger } from '../logger';

const createIntentSchema = Joi.object({
  amount: Joi.number().positive().required(),
  currency: Joi.string().valid('USDC').uppercase().required(),
  metadata: Joi.object().optional(),
});

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

export async function getIntentStatus(req: Request, res: Response): Promise<void> {
  try {
    const merchant = (req as any).merchant;
    const { intentId } = req.params;

    const status = await intentService.getIntentStatus(intentId, merchant.id);
    if (!status) {
      res.status(404).json({ error: 'Payment intent not found' });
      return;
    }

    res.json({ success: true, ...status, expiresAt: status.expiresAt.toISOString() });
  } catch (err: any) {
    logger.error('Intent status fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch payment intent status' });
  }
}
