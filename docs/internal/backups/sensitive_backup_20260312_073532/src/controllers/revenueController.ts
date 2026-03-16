/**
 * Unified Revenue Controller
 * Handles all revenue streams in a single accounting engine
 *
 * Revenue Streams:
 * 1. Credit Consumption (Human → Bot tips)
 * 2. On-Chain Verification (Bot → Bot payments)
 * 3. Marketplace Commissions (Service sales)
 * 4. Subscription Recurring (SaaS tiers)
 */

import { Request, Response } from 'express';
import { query } from '../db/index.js';
import { emitReputationEvent } from '../services/reputationService.js';
import { logger } from '../logger.js';

// Revenue stream types
export enum RevenueStream {
  CREDIT_CONSUMPTION = 'CREDIT_CONSUMPTION',
  ON_CHAIN_VERIFICATION = 'ON_CHAIN_VERIFICATION',
  MARKETPLACE_COMMISSION = 'MARKETPLACE_COMMISSION',
  SUBSCRIPTION_RECURRING = 'SUBSCRIPTION_RECURRING',
}

// Fee constants for each revenue layer
export const CREDIT_FEE_PERCENT = 0.05; // Layer 1: 5% platform fee on credit bundles
export const VERIFICATION_FEE_PERCENT = 0.02; // Layer 2: 2% per bot-to-bot verification
export const MARKETPLACE_FEE_DEFAULT_PERCENT = 0.075; // Layer 3: 7.5% default (range 5–10%)
export const MARKETPLACE_FEE_MIN_PERCENT = 0.05;
export const MARKETPLACE_FEE_MAX_PERCENT = 0.10;

// Layer 4: Subscription tier pricing (USD/month)
export const SUBSCRIPTION_TIERS: Record<string, number> = {
  basic: 9,
  pro: 29,
  enterprise: 99,
};

// Revenue event interface
export interface RevenueEvent {
  id?: string;
  stream: RevenueStream;
  amount: number;
  fee: number;
  net_to_recipient: number;
  from_entity_type: 'human' | 'bot';
  from_entity_id: string;
  to_entity_type: 'bot' | 'platform';
  to_entity_id: string;
  metadata?: Record<string, unknown>;
  created_at?: Date;
}

/**
 * Persists a revenue event to the revenue_events table.
 */
async function recordRevenueEvent(event: RevenueEvent): Promise<RevenueEvent> {
  const result = await query(
    `INSERT INTO revenue_events
       (stream, amount, fee, net_to_recipient,
        from_entity_type, from_entity_id,
        to_entity_type, to_entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, stream, amount, fee, net_to_recipient,
               from_entity_type, to_entity_type,
               from_entity_id AS "from_entity_id",
               to_entity_id AS "to_entity_id",
               metadata, created_at`,
    [
      event.stream,
      event.amount,
      event.fee,
      event.net_to_recipient,
      event.from_entity_type,
      event.from_entity_id,
      event.to_entity_type,
      event.to_entity_id,
      event.metadata ? JSON.stringify(event.metadata) : null,
    ]
  );
  return result.rows[0] as RevenueEvent;
}

/**
 * Main Revenue Controller
 */
export class RevenueController {
  /**
   * Process Credit Consumption
   * When a human tips/pays a bot using platform credits (Layer 1).
   * Platform retains a 5% fee; the remainder goes to the bot.
   */
  static async processCreditConsumption(data: {
    user_id: string;
    bot_id: string;
    credits_amount: number;
  }): Promise<RevenueEvent> {
    const { user_id, bot_id, credits_amount } = data;
    const fee = parseFloat((credits_amount * CREDIT_FEE_PERCENT).toFixed(6));
    const net_to_recipient = parseFloat((credits_amount - fee).toFixed(6));

    const event: RevenueEvent = {
      stream: RevenueStream.CREDIT_CONSUMPTION,
      amount: credits_amount,
      fee,
      net_to_recipient,
      from_entity_type: 'human',
      from_entity_id: user_id,
      to_entity_type: 'bot',
      to_entity_id: bot_id,
      metadata: { user_id, bot_id },
    };

    const recorded = await recordRevenueEvent(event);

    logger.info('Revenue: credit consumption processed', {
      user_id,
      bot_id,
      credits_amount,
      fee,
      net_to_recipient,
    });

    return recorded;
  }

  /**
   * Process On-Chain Verification
   * Bot-to-bot USDC payment with a 2% verification fee (Layer 2).
   * Emits a reputation event for the sending bot.
   */
  static async processOnChainVerification(data: {
    from_bot_id: string;
    to_bot_id: string;
    amount_usdc: number;
    transaction_hash?: string;
    succeeded?: boolean;
  }): Promise<RevenueEvent> {
    const { from_bot_id, to_bot_id, amount_usdc, transaction_hash, succeeded = true } = data;
    const fee = parseFloat((amount_usdc * VERIFICATION_FEE_PERCENT).toFixed(6));
    const net_to_recipient = parseFloat((amount_usdc - fee).toFixed(6));

    const event: RevenueEvent = {
      stream: RevenueStream.ON_CHAIN_VERIFICATION,
      amount: amount_usdc,
      fee,
      net_to_recipient,
      from_entity_type: 'bot',
      from_entity_id: from_bot_id,
      to_entity_type: 'bot',
      to_entity_id: to_bot_id,
      metadata: { from_bot_id, to_bot_id, transaction_hash },
    };

    const recorded = await recordRevenueEvent(event);

    // Update sender's reputation based on payment outcome
    await emitReputationEvent(from_bot_id, succeeded);

    logger.info('Revenue: on-chain verification processed', {
      from_bot_id,
      to_bot_id,
      amount_usdc,
      fee,
      net_to_recipient,
      succeeded,
    });

    return recorded;
  }

  /**
   * Process Marketplace Commission
   * Platform takes a commission (5–10%) on service sales (Layer 3).
   * Escrow is held until proof-of-work is confirmed.
   */
  static async processMarketplaceCommission(data: {
    buyer_id: string;
    seller_id: string;
    service_id: string;
    amount: number;
    commission_percent?: number;
  }): Promise<RevenueEvent> {
    const {
      buyer_id,
      seller_id,
      service_id,
      amount,
      commission_percent = MARKETPLACE_FEE_DEFAULT_PERCENT,
    } = data;

    const clampedRate = Math.min(
      MARKETPLACE_FEE_MAX_PERCENT,
      Math.max(MARKETPLACE_FEE_MIN_PERCENT, commission_percent)
    );
    const fee = parseFloat((amount * clampedRate).toFixed(6));
    const net_to_recipient = parseFloat((amount - fee).toFixed(6));

    const event: RevenueEvent = {
      stream: RevenueStream.MARKETPLACE_COMMISSION,
      amount,
      fee,
      net_to_recipient,
      from_entity_type: 'bot',
      from_entity_id: buyer_id,
      to_entity_type: 'bot',
      to_entity_id: seller_id,
      metadata: { buyer_id, seller_id, service_id, commission_percent: clampedRate },
    };

    const recorded = await recordRevenueEvent(event);

    logger.info('Revenue: marketplace commission processed', {
      buyer_id,
      seller_id,
      service_id,
      amount,
      fee,
      net_to_recipient,
    });

    return recorded;
  }

  /**
   * Process Subscription Recurring
   * SaaS subscription revenue for verified tiers (Layer 4).
   * Full subscription amount is platform revenue.
   */
  static async processSubscriptionRecurring(data: {
    subscriber_id: string;
    tier: string;
    amount?: number;
  }): Promise<RevenueEvent> {
    const { subscriber_id, tier } = data;
    const amount = data.amount ?? SUBSCRIPTION_TIERS[tier];
    if (amount === undefined) {
      throw new Error(`Unknown subscription tier "${tier}". Provide an explicit amount or use a known tier: ${Object.keys(SUBSCRIPTION_TIERS).join(', ')}.`);
    }

    const event: RevenueEvent = {
      stream: RevenueStream.SUBSCRIPTION_RECURRING,
      amount,
      fee: 0,
      net_to_recipient: 0,
      from_entity_type: 'human',
      from_entity_id: subscriber_id,
      to_entity_type: 'platform',
      to_entity_id: 'platform',
      metadata: { subscriber_id, tier },
    };

    const recorded = await recordRevenueEvent(event);

    logger.info('Revenue: subscription recurring processed', {
      subscriber_id,
      tier,
      amount,
    });

    return recorded;
  }

  // ─── HTTP Handlers ────────────────────────────────────────────────────────

  static async handleCreditConsumption(req: Request, res: Response): Promise<void> {
    const { user_id, bot_id, credits_amount } = req.body;
    if (!user_id || !bot_id || typeof credits_amount !== 'number' || credits_amount <= 0) {
      res.status(400).json({ error: 'user_id, bot_id and a positive credits_amount are required' });
      return;
    }
    try {
      const event = await RevenueController.processCreditConsumption({ user_id, bot_id, credits_amount });
      res.status(201).json({ success: true, event });
    } catch (err: any) {
      logger.error('Revenue credit consumption error', err);
      res.status(500).json({ error: 'Failed to process credit consumption' });
    }
  }

  static async handleOnChainVerification(req: Request, res: Response): Promise<void> {
    const { from_bot_id, to_bot_id, amount_usdc, transaction_hash, succeeded } = req.body;
    if (!from_bot_id || !to_bot_id || typeof amount_usdc !== 'number' || amount_usdc <= 0) {
      res.status(400).json({ error: 'from_bot_id, to_bot_id and a positive amount_usdc are required' });
      return;
    }
    try {
      const event = await RevenueController.processOnChainVerification({
        from_bot_id,
        to_bot_id,
        amount_usdc,
        transaction_hash,
        succeeded: succeeded ?? true,
      });
      res.status(201).json({ success: true, event });
    } catch (err: any) {
      logger.error('Revenue on-chain verification error', err);
      res.status(500).json({ error: 'Failed to process on-chain verification' });
    }
  }

  static async handleMarketplaceCommission(req: Request, res: Response): Promise<void> {
    const { buyer_id, seller_id, service_id, amount, commission_percent } = req.body;
    if (!buyer_id || !seller_id || !service_id || typeof amount !== 'number' || amount <= 0) {
      res.status(400).json({ error: 'buyer_id, seller_id, service_id and a positive amount are required' });
      return;
    }
    try {
      const event = await RevenueController.processMarketplaceCommission({
        buyer_id,
        seller_id,
        service_id,
        amount,
        commission_percent,
      });
      res.status(201).json({ success: true, event });
    } catch (err: any) {
      logger.error('Revenue marketplace commission error', err);
      res.status(500).json({ error: 'Failed to process marketplace commission' });
    }
  }

  static async handleSubscriptionRecurring(req: Request, res: Response): Promise<void> {
    const { subscriber_id, tier, amount } = req.body;
    if (!subscriber_id || !tier) {
      res.status(400).json({ error: 'subscriber_id and tier are required' });
      return;
    }
    if (!SUBSCRIPTION_TIERS[tier] && typeof amount !== 'number') {
      res.status(400).json({
        error: `Unknown tier "${tier}". Valid tiers: ${Object.keys(SUBSCRIPTION_TIERS).join(', ')}. Provide an explicit amount for custom tiers.`,
      });
      return;
    }
    try {
      const event = await RevenueController.processSubscriptionRecurring({ subscriber_id, tier, amount });
      res.status(201).json({ success: true, event });
    } catch (err: any) {
      logger.error('Revenue subscription error', err);
      res.status(500).json({ error: 'Failed to process subscription' });
    }
  }

  static async handleGetRevenueSummary(req: Request, res: Response): Promise<void> {
    try {
      const result = await query(
        `SELECT stream,
                COUNT(*) AS event_count,
                SUM(amount) AS total_gross,
                SUM(fee) AS total_fees,
                SUM(net_to_recipient) AS total_net
         FROM revenue_events
         GROUP BY stream
         ORDER BY stream`
      );

      const summary = result.rows.reduce(
        (acc: Record<string, unknown>, row: any) => {
          acc[row.stream] = {
            event_count: parseInt(row.event_count, 10),
            total_gross: parseFloat(row.total_gross),
            total_fees: parseFloat(row.total_fees),
            total_net: parseFloat(row.total_net),
          };
          return acc;
        },
        {}
      );

      res.json({ success: true, summary });
    } catch (err: any) {
      logger.error('Revenue summary error', err);
      res.status(500).json({ error: 'Failed to retrieve revenue summary' });
    }
  }
}

export default RevenueController;
