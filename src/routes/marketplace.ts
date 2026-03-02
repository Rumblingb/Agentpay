/**
 * AgentPay Marketplace Routes
 *
 * REST endpoints for service listings CRUD, search,
 * purchase flow, and transaction status management.
 */

import { Router, Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import * as marketplaceService from '../services/marketplaceService';
import * as intentService from '../services/intentService';
import { logger } from '../logger';

const router = Router();

// ── Validation Schemas ─────────────────────────────────────────────────────

const createListingSchema = Joi.object({
  botHandle: Joi.string().min(1).max(255).required(),
  title: Joi.string().min(1).max(255).required(),
  description: Joi.string().min(1).max(2000).required(),
  priceCents: Joi.number().integer().min(0).required(),
  category: Joi.string().min(1).max(100).required(),
  metadata: Joi.object().optional(),
});

const updateListingSchema = Joi.object({
  title: Joi.string().min(1).max(255).optional(),
  description: Joi.string().min(1).max(2000).optional(),
  priceCents: Joi.number().integer().min(0).optional(),
  category: Joi.string().min(1).max(100).optional(),
  metadata: Joi.object().optional(),
});

const purchaseSchema = Joi.object({
  listingId: Joi.string().min(1).required(),
  buyerBotHandle: Joi.string().min(1).max(255).required(),
  merchantId: Joi.string().uuid().required(),
  agentId: Joi.string().min(1).max(255).required(),
});

// ── Search ─────────────────────────────────────────────────────────────────

/**
 * GET /api/marketplace/search
 * Full-text search with AgentRank sorting.
 */
router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const results = await marketplaceService.searchServices(query, category, limit);
    res.json({ success: true, results });
  } catch (error) {
    next(error);
  }
});

// ── Listings CRUD ──────────────────────────────────────────────────────────

/**
 * GET /api/marketplace/listings/:id
 */
router.get('/listings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const listing = await marketplaceService.getServiceListing(req.params.id);
    if (!listing) {
      res.status(404).json({ error: 'Listing not found' });
      return;
    }
    res.json({ success: true, listing });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/marketplace/listings
 */
router.post('/listings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { error, value } = createListingSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d) => d.message),
      });
      return;
    }

    const listing = await marketplaceService.createServiceListing(value.botHandle, {
      title: value.title,
      description: value.description,
      priceCents: value.priceCents,
      category: value.category,
      metadata: value.metadata,
    });

    res.status(201).json({ success: true, listing });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/marketplace/listings/:id
 */
router.patch('/listings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { error, value } = updateListingSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d) => d.message),
      });
      return;
    }

    const listing = await marketplaceService.updateServiceListing(req.params.id, value);
    if (!listing) {
      res.status(404).json({ error: 'Listing not found' });
      return;
    }
    res.json({ success: true, listing });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/marketplace/listings/:id
 */
router.delete('/listings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await marketplaceService.deleteServiceListing(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Listing not found' });
      return;
    }
    res.json({ success: true, message: 'Listing deleted' });
  } catch (error) {
    next(error);
  }
});

// ── Purchase ───────────────────────────────────────────────────────────────

/**
 * POST /api/marketplace/purchase
 *
 * Validates listing exists, creates a payment intent via the existing
 * v1 intents pipeline, and records the service transaction.
 */
router.post('/purchase', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { error, value } = purchaseSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d) => d.message),
      });
      return;
    }

    const { listingId, buyerBotHandle, merchantId, agentId } = value;

    // 1. Validate listing exists
    const listing = await marketplaceService.getServiceListing(listingId);
    if (!listing) {
      res.status(404).json({ error: 'Listing not found' });
      return;
    }

    // 2. Create payment intent through the intent service
    const amountUsdc = listing.priceCents / 100;

    const intentResult = await intentService.createIntent({
      merchantId,
      amount: amountUsdc,
      currency: 'USDC',
      metadata: {
        agentId,
        listingId,
        buyerBotHandle,
        sellerBotHandle: listing.botHandle,
        type: 'marketplace_purchase',
      },
    });

    // 3. Record the service transaction
    const transaction = await marketplaceService.recordServicePurchase(
      intentResult.intentId,
      listingId,
      buyerBotHandle,
      listing.botHandle,
      listing.priceCents,
    );

    logger.info('Marketplace purchase initiated', {
      intentId: intentResult.intentId,
      listingId,
      buyerBotHandle,
    });

    res.status(201).json({
      success: true,
      intentId: intentResult.intentId,
      transactionId: transaction.id,
      paymentUrl: intentResult.instructions.solanaPayUri,
      expiresAt: intentResult.expiresAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

// ── Transaction Status ─────────────────────────────────────────────────────

/**
 * POST /api/marketplace/transactions/:id/complete
 */
router.post('/transactions/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tx = await marketplaceService.markServiceCompleted(req.params.id);
    if (!tx) {
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }
    res.json({ success: true, transaction: tx });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/marketplace/transactions/:id/fail
 */
router.post('/transactions/:id/fail', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tx = await marketplaceService.markServiceFailed(req.params.id);
    if (!tx) {
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }
    res.json({ success: true, transaction: tx });
  } catch (error) {
    next(error);
  }
});

export default router;
