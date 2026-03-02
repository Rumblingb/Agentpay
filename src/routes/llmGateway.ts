/**
 * LLM Gateway Routes
 *
 * Provides API endpoints for AI agents to access LLM inference through AgentPay.
 * All requests are authenticated, spending-policy checked, and billed automatically.
 *
 * Routes:
 *   POST /api/llm/chat/completions   — Proxy a chat completion request
 *   POST /api/llm/micropayment       — Process a micropayment (boost/upvote)
 *   GET  /api/llm/models             — List supported models and pricing
 */

import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticateApiKey } from '../middleware/auth';
import * as llmGateway from '../services/llmGateway';
import { logger } from '../logger';

interface AuthRequest extends Request {
  merchant?: {
    id: string;
    name: string;
    email: string;
    walletAddress: string;
  };
}

const router = Router();

// ── Validation Schemas ─────────────────────────────────────────────────────

const chatCompletionSchema = Joi.object({
  agentId: Joi.string().min(1).max(255).required(),
  provider: Joi.string().valid('openai', 'anthropic', 'groq').required(),
  model: Joi.string().min(1).max(100).required(),
  messages: Joi.array()
    .items(
      Joi.object({
        role: Joi.string().valid('system', 'user', 'assistant').required(),
        content: Joi.string().min(1).required(),
      }),
    )
    .min(1)
    .required(),
  maxTokens: Joi.number().integer().min(1).max(128000).optional(),
  temperature: Joi.number().min(0).max(2).optional(),
  metadata: Joi.object().optional(),
});

const micropaymentSchema = Joi.object({
  agentId: Joi.string().min(1).max(255).required(),
  amount: Joi.number().positive().max(1.00).required(), // Max $1.00 per micropayment
  description: Joi.string().min(1).max(500).required(),
  metadata: Joi.object().optional(),
});

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/llm/chat/completions
 *
 * Proxies a chat completion request to the specified LLM provider.
 * Requires merchant authentication. The agent is identified via agentId in body.
 */
router.post('/chat/completions', authenticateApiKey, async (req: AuthRequest, res: Response) => {
  const { error, value } = chatCompletionSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Validation error',
      details: error.details.map((d) => d.message),
    });
  }

  try {
    const result = await llmGateway.processLLMRequest({
      merchantId: req.merchant!.id,
      agentId: value.agentId,
      provider: value.provider,
      model: value.model,
      messages: value.messages,
      maxTokens: value.maxTokens,
      temperature: value.temperature,
      metadata: value.metadata,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    const status = err.status || 500;

    if (status === 429) {
      return res.status(429).json({
        error: 'Daily spending limit reached',
        message: err.message,
        spentToday: err.spentToday,
        dailyLimit: err.dailyLimit,
        remaining: err.remaining,
      });
    }

    if (status === 402) {
      return res.status(402).json({
        error: 'PAYMENT_REQUIRED',
        message: err.message,
      });
    }

    logger.error('LLM chat completion error', { err: err.message });
    res.status(status).json({ error: err.message || 'LLM request failed' });
  }
});

/**
 * POST /api/llm/micropayment
 *
 * Processes a small automatic payment (e.g., $0.01 post boost).
 * Auto-approved if within the agent's daily spending policy.
 */
router.post('/micropayment', authenticateApiKey, async (req: AuthRequest, res: Response) => {
  const { error, value } = micropaymentSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Validation error',
      details: error.details.map((d) => d.message),
    });
  }

  try {
    const result = await llmGateway.processMicropayment({
      merchantId: req.merchant!.id,
      agentId: value.agentId,
      amount: value.amount,
      description: value.description,
      metadata: value.metadata,
    });

    if (!result.approved) {
      return res.status(429).json({
        success: false,
        ...result,
      });
    }

    res.status(201).json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    logger.error('Micropayment error', { err: err.message });
    res.status(err.status || 500).json({ error: err.message || 'Micropayment failed' });
  }
});

/**
 * GET /api/llm/models
 *
 * Returns the list of supported LLM models with pricing.
 * Public endpoint — no authentication required.
 */
router.get('/models', (_req: Request, res: Response) => {
  const models = llmGateway.getSupportedModels();
  res.json({
    success: true,
    models,
  });
});

export default router;
