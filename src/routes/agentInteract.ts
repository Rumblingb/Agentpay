/**
 * POST /api/v1/agents/interact
 *
 * High-leverage orchestration endpoint for external agent ecosystems
 * (Clawbot, AutoGPT, LangGraph, CrewAI, and custom agents).
 *
 * A single call can:
 *   - identify the caller and counterparty
 *   - optionally verify identity
 *   - optionally fetch trust context
 *   - record the interaction as a trust event
 *   - optionally create a coordination intent
 *   - emit trust events
 *   - return a structured result with warnings for unavailable steps
 *
 * Auth: Bearer API key (same as all other protected endpoints).
 *
 * This endpoint orchestrates existing services — it does NOT duplicate
 * business logic that already lives elsewhere.
 *
 * @module routes/agentInteract
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { authenticateApiKey, type AuthRequest } from '../middleware/auth.js';
import { identityVerifierAgent } from '../agents/index.js';
import { intentCoordinatorAgent } from '../agents/IntentCoordinatorAgent.js';
import { recordTrustEvent } from '../services/trustEventService.js';
import * as reputationService from '../services/reputationService.js';
import { logger } from '../logger.js';

const router = Router();

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const interactSchema = z.object({
  /** ID of the calling / initiating agent */
  fromAgentId: z.string().min(1).max(256),
  /** ID of the target / counterparty agent */
  toAgentId: z.string().min(1).max(256),
  /** Nature of the interaction */
  interactionType: z.enum(['payment', 'task', 'query', 'delegation', 'custom']),
  /** Service category (e.g. "web-scraping", "data-analysis") */
  service: z.string().max(100).optional(),
  /** Reported outcome — defaults to "success" */
  outcome: z.enum(['success', 'failure', 'pending']).optional().default('success'),
  /** Transaction amount */
  amount: z.number().positive().optional(),
  /** Currency code — defaults to "USDC" */
  currency: z.string().max(10).optional().default('USDC'),
  /** When true, fetch toAgent trust score from the reputation graph */
  trustCheck: z.boolean().optional().default(false),
  /** When true (and amount is provided), create a coordination intent */
  createIntent: z.boolean().optional().default(false),
  /** Arbitrary caller-supplied metadata, attached to the intent if created */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InteractRequest = z.infer<typeof interactSchema>;

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/**
 * POST /interact
 *
 * Single-call integration path for external agents.
 */
router.post('/interact', authenticateApiKey, async (req: AuthRequest, res: Response) => {
  const parsed = interactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e) => e.message),
    });
    return;
  }

  const {
    fromAgentId,
    toAgentId,
    interactionType,
    service,
    outcome,
    amount,
    currency,
    trustCheck,
    createIntent,
    metadata,
  } = parsed.data;

  const interactionId = `interact_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const warnings: string[] = [];

  // ------------------------------------------------------------------
  // Step 1 — Identity lookup (both agents)
  // ------------------------------------------------------------------
  let fromAgentVerified = false;
  let fromAgentTrustLevel = 'unverified';
  let toAgentVerified = false;
  let toAgentTrustLevel = 'unverified';

  try {
    const identity = await identityVerifierAgent.getIdentityRecord(fromAgentId);
    fromAgentVerified = identity.verified;
    fromAgentTrustLevel = identity.trustLevel;
  } catch (err: any) {
    warnings.push(`fromAgent identity lookup unavailable: ${err.message}`);
  }

  try {
    const identity = await identityVerifierAgent.getIdentityRecord(toAgentId);
    toAgentVerified = identity.verified;
    toAgentTrustLevel = identity.trustLevel;
  } catch (err: any) {
    warnings.push(`toAgent identity lookup unavailable: ${err.message}`);
  }

  // ------------------------------------------------------------------
  // Step 2 — Trust / oracle lookup (optional)
  // ------------------------------------------------------------------
  let toAgentTrustScore: number | null = null;
  if (trustCheck) {
    try {
      const reputation = await reputationService.getReputation(toAgentId);
      if (reputation !== null) {
        toAgentTrustScore = reputation.trustScore;
      } else {
        warnings.push('toAgent trust score not available (no reputation record)');
      }
    } catch (err: any) {
      warnings.push(`Trust score lookup failed: ${err.message}`);
    }
  }

  // ------------------------------------------------------------------
  // Step 3 — Record interaction as a trust event
  // ------------------------------------------------------------------
  const trustCategory =
    outcome === 'success' ? 'successful_interaction' : 'failed_interaction';
  let trustEventResult: { score: number; grade: string } | null = null;
  try {
    trustEventResult = await recordTrustEvent(
      fromAgentId,
      trustCategory,
      `${interactionType} with ${toAgentId}${service ? ` (${service})` : ''}`,
    );
  } catch (err: any) {
    warnings.push(`Trust event recording failed: ${err.message}`);
  }

  // ------------------------------------------------------------------
  // Step 4 — Intent coordination (optional)
  // ------------------------------------------------------------------
  let intent: object | null = null;
  if (createIntent) {
    if (amount == null) {
      warnings.push('createIntent requires an amount; intent not created');
    } else {
      try {
        intent = await intentCoordinatorAgent.createIntent({
          intentId: interactionId,
          fromAgent: fromAgentId,
          toAgent: toAgentId,
          amount,
          currency: (currency ?? 'USDC') as 'USD' | 'USDC' | 'SOL',
          purpose: interactionType,
          metadata,
        });
      } catch (err: any) {
        warnings.push(`Intent creation failed: ${err.message}`);
      }
    }
  }

  // ------------------------------------------------------------------
  // Collect emitted trust events for the response
  // ------------------------------------------------------------------
  const emittedEvents = trustEventResult
    ? [
        {
          category: trustCategory,
          agentId: fromAgentId,
          delta: outcome === 'success' ? 5 : -5,
          score: trustEventResult.score,
          grade: trustEventResult.grade,
        },
      ]
    : [];

  logger.info('Agent interaction recorded', {
    interactionId,
    fromAgentId,
    toAgentId,
    interactionType,
    outcome,
    merchantId: req.merchant?.id,
  });

  res.status(200).json({
    success: true,
    interactionId,
    fromAgent: {
      agentId: fromAgentId,
      verified: fromAgentVerified,
      trustLevel: fromAgentTrustLevel,
    },
    toAgent: {
      agentId: toAgentId,
      verified: toAgentVerified,
      trustLevel: toAgentTrustLevel,
      ...(trustCheck ? { trustScore: toAgentTrustScore } : {}),
    },
    interaction: {
      type: interactionType,
      service: service ?? null,
      outcome,
      ...(amount != null ? { amount, currency: currency ?? 'USDC' } : {}),
      metadata: metadata ?? null,
    },
    intent,
    emittedEvents,
    warnings,
  });
});

export default router;
