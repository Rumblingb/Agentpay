/**
 * Agent-facing payment-intent routes (versioned API: /api/v1/payment-intents).
 *
 * Unlike the merchant-authenticated /api/intents, these endpoints are designed
 * for AI agents to initiate payments without a merchant-issued API key.
 * Authentication is done by providing a merchantId that the agent is paying.
 */
import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { validate as uuidValidate } from 'uuid';
import * as intentService from '../services/intentService.js';
import * as agentIdentityService from '../services/agentIdentityService.js';
import { query } from '../db/index.js';
import { logger } from '../logger.js';

const router = Router();

const createAgentIntentSchema = Joi.object({
  merchantId: Joi.string().uuid().required(),
  agentId: Joi.string().min(1).max(255).required(),
  amount: Joi.number().positive().required(),
  currency: Joi.string().valid('USDC').uppercase().default('USDC'),
  pin: Joi.string().optional(),
  metadata: Joi.object().optional(),
});

/**
 * POST /api/v1/payment-intents
 *
 * Agent-initiated payment intent. The agent specifies which merchant they want
 * to pay, their own agentId, the amount, and optional metadata.
 * Returns payment instructions for both crypto (Solana/USDC) and fiat (Stripe)
 * if the merchant has completed Stripe Connect onboarding.
 */
router.post('/', async (req: Request, res: Response) => {
  const { error, value } = createAgentIntentSchema.validate(req.body);
  if (error) {
    res.status(400).json({
      error: 'Validation error',
      details: error.details.map((d) => d.message),
    });
    return;
  }

  const { merchantId, agentId, amount, currency, pin, metadata } = value;

  try {
    // If a PIN is provided, verify it before proceeding
    if (pin) {
      const pinValid = await agentIdentityService.verifyPin(agentId, pin);
      if (!pinValid) {
        res.status(401).json({ error: 'Invalid PIN' });
        return;
      }
    }

    // Look up merchant to validate existence and fetch wallet + Stripe account
    const merchantResult = await query(
      `SELECT id, wallet_address, webhook_url, stripe_connected_account_id
         FROM merchants WHERE id = $1 AND is_active = true`,
      [merchantId]
    );

    if (merchantResult.rows.length === 0) {
      res.status(404).json({ error: 'Merchant not found' });
      return;
    }

    const merchantRow = merchantResult.rows[0];

    // Embed agentId in metadata so reputation can be tracked
    const intentMetadata = { ...(metadata ?? {}), agentId };

    const result = await intentService.createIntent({
      merchantId,
      amount,
      currency,
      metadata: intentMetadata,
    });

    // Build instructions object
    const instructions: Record<string, unknown> = {
      crypto: {
        network: 'solana',
        token: 'USDC',
        recipientAddress: merchantRow.wallet_address,
        amount,
        memo: result.verificationToken,
        solanaPayUri: result.instructions.solanaPayUri,
      },
    };

    // Include Stripe checkout URL if the merchant has a connected account
    if (merchantRow.stripe_connected_account_id) {
      instructions.fiat = {
        provider: 'stripe',
        note: 'Use POST /api/intents/fiat with merchant API key for Stripe checkout URL',
      };
    }

    logger.info('Agent payment intent created', {
      intentId: result.intentId,
      merchantId,
      agentId,
    });

    res.status(201).json({
      success: true,
      intentId: result.intentId,
      verificationToken: result.verificationToken,
      expiresAt: result.expiresAt.toISOString(),
      instructions,
    });
  } catch (err: any) {
    logger.error('Agent intent creation error', { err });
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

/**
 * GET /api/v1/payment-intents/:intentId
 *
 * Public status check for an intent. Agents can poll this to know
 * when their payment has been verified.
 */
router.get('/:intentId', async (req: Request, res: Response) => {
  const { intentId } = req.params;

  if (!intentId || !uuidValidate(intentId)) {
    res.status(400).json({ error: 'Invalid intent ID' });
    return;
  }

  try {
    const result = await query(
      `SELECT id, merchant_id, amount, currency, status, verification_token,
              expires_at, metadata, created_at
         FROM payment_intents WHERE id = $1`,
      [intentId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Payment intent not found' });
      return;
    }

    const intent = result.rows[0];

    // Auto-expire overdue pending intents
    if (intent.status === 'pending' && new Date(intent.expires_at) < new Date()) {
      await query(
        `UPDATE payment_intents SET status = 'expired', updated_at = NOW() WHERE id = $1`,
        [intentId]
      );
      intent.status = 'expired';
    }

    res.json({
      success: true,
      intentId: intent.id,
      merchantId: intent.merchant_id,
      amount: Number(intent.amount),
      currency: intent.currency,
      status: intent.status,
      verificationToken: intent.verification_token,
      expiresAt: new Date(intent.expires_at).toISOString(),
      metadata: intent.metadata,
    });
  } catch (err: any) {
    logger.error('Agent intent status error', { err });
    res.status(500).json({ error: 'Failed to fetch payment intent' });
  }
});

const verifyIntentSchema = Joi.object({
  txHash: Joi.string().alphanum().min(32).max(128).required(),
});

/**
 * POST /api/v1/payment-intents/:intentId/verify
 *
 * Agents submit the on-chain transaction hash that pays this intent.
 * The hash is stored in the intent's metadata so the Solana listener can
 * pick it up on the next poll cycle, verify it on-chain, and atomically
 * update the intent status + create a transactions record.
 *
 * Returns immediately with `queued: true` — the listener confirms within
 * one poll interval (default 30 s).
 */
router.post('/:intentId/verify', async (req: Request, res: Response) => {
  const { intentId } = req.params;

  if (!intentId || !uuidValidate(intentId)) {
    res.status(400).json({ error: 'Invalid intent ID' });
    return;
  }

  const { error, value } = verifyIntentSchema.validate(req.body);
  if (error) {
    res.status(400).json({
      error: 'Validation error',
      details: error.details.map((d) => d.message),
    });
    return;
  }

  try {
    const result = await query(
      `SELECT id, status, metadata, expires_at
         FROM payment_intents WHERE id = $1`,
      [intentId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Payment intent not found' });
      return;
    }

    const intent = result.rows[0];

    if (intent.status !== 'pending') {
      res.status(409).json({
        error: 'Intent is not pending',
        status: intent.status,
      });
      return;
    }

    if (new Date(intent.expires_at) < new Date()) {
      await query(
        `UPDATE payment_intents SET status = 'expired', updated_at = NOW() WHERE id = $1`,
        [intentId]
      );
      res.status(410).json({ error: 'Payment intent has expired' });
      return;
    }

    // Merge tx_hash into the intent's metadata; the listener will process it
    const existingMeta = (intent.metadata ?? {}) as Record<string, unknown>;
    const updatedMeta = { ...existingMeta, tx_hash: value.txHash };

    await query(
      `UPDATE payment_intents
          SET metadata   = $1::jsonb,
              updated_at = NOW()
        WHERE id = $2 AND status = 'pending'`,
      [JSON.stringify(updatedMeta), intentId]
    );

    logger.info('Intent tx_hash queued for verification', { intentId, txHash: value.txHash });

    res.json({
      success: true,
      queued: true,
      intentId,
      txHash: value.txHash,
      message: 'Transaction hash received. The listener will confirm on-chain within the next poll cycle.',
    });
  } catch (err: any) {
    logger.error('Intent verify error', { err });
    res.status(500).json({ error: 'Failed to queue verification' });
  }
});

export default router;

