/**
 * Moltbook API Routes
 *
 * Bot Wallet Dashboard:
 *   GET  /api/moltbook/bots/:botId/overview
 *   GET  /api/moltbook/bots/:botId/history
 *   GET  /api/moltbook/bots/:botId/services
 *   GET  /api/moltbook/bots/:botId/subscriptions
 *
 * Spending Policy:
 *   GET  /api/moltbook/bots/:botId/spending-policy
 *   PATCH /api/moltbook/bots/:botId/spending-policy
 *
 * Marketplace:
 *   GET  /api/moltbook/services
 *   GET  /api/moltbook/services/:serviceId
 *   POST /api/moltbook/services/search
 *
 * Subscriptions:
 *   POST /api/moltbook/subscriptions/retry/:subscriptionId
 *
 * Reputation:
 *   GET  /api/moltbook/reputation/:botId
 *   GET  /api/moltbook/reputation/top
 *
 * Admin Analytics (authenticated):
 *   GET  /api/admin/moltbook/stats/daily
 *   GET  /api/admin/moltbook/stats/tips
 *   GET  /api/admin/moltbook/stats/services
 *   GET  /api/admin/moltbook/stats/revenue
 */

import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import Joi from 'joi';
import { authenticateApiKey } from '../middleware/auth.js';
import * as moltbookService from '../services/moltbookService.js';
import { logger } from '../logger.js';

export const moltbookRouter = Router();
export const adminMoltbookRouter = Router();

// ── Rate limiters ──────────────────────────────────────────────────────────

const postLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

const strictPostLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

// ── Validation schemas ─────────────────────────────────────────────────────

const botRegistrationSchema = Joi.object({
  handle: Joi.string().min(1).max(255).required(),
  display_name: Joi.string().max(255).optional(),
  bio: Joi.string().max(1000).allow('', null).optional(),
  created_by: Joi.string().max(255).optional(),
  primary_function: Joi.string().max(100).optional(),
  platform_bot_id: Joi.string().max(255).optional(),
});

const spendingPolicySchema = Joi.object({
  dailySpendingLimit: Joi.number().positive().max(10000).optional(),
  perTxLimit: Joi.number().positive().max(10000).optional(),
  autoApproveUnder: Joi.number().min(0).max(10000).optional(),
  dailyAutoApproveCap: Joi.number().min(0).max(10000).optional(),
  requirePinAbove: Joi.number().positive().allow(null).optional(),
  alertWebhookUrl: Joi.string().uri().allow(null, '').optional(),
  pin: Joi.string().min(4).max(64).optional(),
});

const serviceSearchSchema = Joi.object({
  q: Joi.string().max(200).optional(),
  category: Joi.string().max(100).optional(),
  tags: Joi.array().items(Joi.string().max(50)).max(10).optional(),
  minPrice: Joi.number().min(0).optional(),
  maxPrice: Joi.number().min(0).optional(),
  minReputation: Joi.number().min(0).max(100).optional(),
  sortBy: Joi.string().valid('uses', 'rating', 'revenue', 'reputation').optional(),
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
});

// ── Helper ─────────────────────────────────────────────────────────────────

function handleError(res: Response, error: unknown, message: string): void {
  logger.error(message, { error });
  res.status(500).json({ error: message });
}

// ── Bot Registration ───────────────────────────────────────────────────────

/**
 * POST /api/moltbook/bots/register
 * Register a bot with smart defaults. Only `handle` is required.
 */
moltbookRouter.post('/bots/register', strictPostLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { error, value } = botRegistrationSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d) => d.message),
        help: {
          suggestion: 'Only the handle field is required. All other fields use smart defaults.',
          example: { handle: '@MyBot' },
          fix: 'POST /api/moltbook/bots/register',
        },
      });
      return;
    }

    const result = await moltbookService.registerBot(value.handle, {
      display_name: value.display_name,
      bio: value.bio,
      created_by: value.created_by,
      primary_function: value.primary_function,
      platform_bot_id: value.platform_bot_id,
    });

    if (!result) {
      res.status(409).json({
        error: 'HANDLE_TAKEN',
        message: `A bot with handle "${value.handle}" already exists.`,
        help: {
          suggestion: 'Choose a different handle for your bot.',
          fix: 'POST /api/moltbook/bots/register with a unique handle',
        },
      });
      return;
    }

    res.status(201).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// ── Bot Wallet Dashboard ───────────────────────────────────────────────────

moltbookRouter.get('/bots/:botId/overview', authenticateApiKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const overview = await moltbookService.getBotOverview(req.params.botId);
    if (!overview) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    res.json({ success: true, data: overview });
  } catch (error) {
    next(error);
  }
});

moltbookRouter.get('/bots/:botId/history', authenticateApiKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const result = await moltbookService.getBotHistory(req.params.botId, limit, offset);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

moltbookRouter.get('/bots/:botId/services', authenticateApiKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const services = await moltbookService.getBotServices(req.params.botId);
    res.json({ success: true, services });
  } catch (error) {
    next(error);
  }
});

moltbookRouter.get('/bots/:botId/subscriptions', authenticateApiKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const subscriptions = await moltbookService.getBotSubscriptions(req.params.botId);
    res.json({ success: true, subscriptions });
  } catch (error) {
    next(error);
  }
});

// ── Spending Policy ────────────────────────────────────────────────────────

moltbookRouter.get('/bots/:botId/spending-policy', authenticateApiKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const policy = await moltbookService.getSpendingPolicy(req.params.botId);
    if (!policy) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    res.json({ success: true, policy });
  } catch (error) {
    next(error);
  }
});

moltbookRouter.patch('/bots/:botId/spending-policy', strictPostLimiter, authenticateApiKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { error, value } = spendingPolicySchema.validate(req.body);
    if (error) {
      res.status(400).json({ error: 'Validation error', details: error.details.map((d) => d.message) });
      return;
    }

    const policy = await moltbookService.updateSpendingPolicy(req.params.botId, value);
    if (!policy) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    res.json({ success: true, policy });
  } catch (error) {
    next(error);
  }
});

// ── Marketplace ────────────────────────────────────────────────────────────

moltbookRouter.get('/services', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const sortBy = (['uses', 'rating', 'revenue'] as const).find((s) => s === req.query.sortBy) ?? 'uses';
    const result = await moltbookService.listServices(limit, offset, category, sortBy);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// NOTE: /services/search must be registered before /services/:serviceId
// so the literal path "search" is matched before the :serviceId param.
moltbookRouter.post('/services/search', postLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { error, value } = serviceSearchSchema.validate(req.body);
    if (error) {
      res.status(400).json({ error: 'Validation error', details: error.details.map((d) => d.message) });
      return;
    }
    const result = await moltbookService.searchServices(value);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

moltbookRouter.get('/services/:serviceId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = await moltbookService.getService(req.params.serviceId);
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    res.json({ success: true, service });
  } catch (error) {
    next(error);
  }
});

// ── Subscriptions ──────────────────────────────────────────────────────────

moltbookRouter.post('/subscriptions/retry/:subscriptionId', strictPostLimiter, authenticateApiKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await moltbookService.retrySubscription(req.params.subscriptionId);
    const statusCode = result.success ? 200 : 400;
    res.status(statusCode).json(result);
  } catch (error) {
    next(error);
  }
});

// ── Reputation ─────────────────────────────────────────────────────────────

moltbookRouter.get('/reputation/top', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    const bots = await moltbookService.getTopReputation(limit);
    res.json({ success: true, bots });
  } catch (error) {
    next(error);
  }
});

moltbookRouter.get('/reputation/:botId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reputation = await moltbookService.getBotReputation(req.params.botId);
    if (!reputation) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    res.json({ success: true, reputation });
  } catch (error) {
    next(error);
  }
});

// ── Admin Analytics ────────────────────────────────────────────────────────

adminMoltbookRouter.get('/stats/daily', authenticateApiKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const stats = await moltbookService.getDailyStats(date);
    res.json({ success: true, stats });
  } catch (error) {
    next(error);
  }
});

adminMoltbookRouter.get('/stats/tips', authenticateApiKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const stats = await moltbookService.getTipsStats(days);
    res.json({ success: true, stats });
  } catch (error) {
    next(error);
  }
});

adminMoltbookRouter.get('/stats/services', authenticateApiKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await moltbookService.getServicesStats();
    res.json({ success: true, stats });
  } catch (error) {
    next(error);
  }
});

adminMoltbookRouter.get('/stats/revenue', authenticateApiKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const stats = await moltbookService.getRevenueStats(days);
    res.json({ success: true, stats });
  } catch (error) {
    next(error);
  }
});

export default moltbookRouter;
