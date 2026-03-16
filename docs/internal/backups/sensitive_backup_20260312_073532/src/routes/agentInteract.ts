/**
 * POST /api/v1/agents/interact
 *
 * High-leverage orchestration endpoint for external agent ecosystems
 * (Clawbot, AutoGPT, LangGraph, CrewAI, and custom agents).
 *
 * A single call can:
 *   - look up both agent identities (identityFound / identityVerified are distinct fields)
 *   - optionally fetch counterparty trust score
 *   - record the interaction in the canonical trust event pipeline
 *   - optionally create a coordination intent
 *   - emit trust events to webhook subscribers
 *   - return a structured result with warnings for unavailable soft-fail steps
 *
 * Auth: Bearer API key (same as all other protected endpoints).
 *
 * This endpoint orchestrates existing services — it does NOT duplicate
 * business logic that already lives elsewhere.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Hard-fail vs soft-fail contract
 * ──────────────────────────────────────────────────────────────────────
 * HARD FAIL (4xx returned immediately):
 *   • Schema / type validation errors        → 400
 *   • Missing auth / invalid API key         → 401 (enforced by middleware)
 *   • createIntent:true without amount       → 400 (impossible payload)
 *
 * SOFT FAIL (200 returned, step surfaced in warnings[]):
 *   • Identity record lookup unavailable     → warning, defaults to identityFound=false
 *   • Trust score (oracle) unavailable       → warning, trustScore omitted
 *   • Trust event recording DB error         → warning, emittedEvents=[]
 *   • Intent coordinator downstream failure  → warning, intent=null
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Score delta applied to fromAgent on a successful interaction. Mirrors TRUST_EVENT_CATALOG. */
const SUCCESSFUL_INTERACTION_DELTA = 5;
/** Score delta applied to fromAgent on a failed interaction. Mirrors TRUST_EVENT_CATALOG. */
const FAILED_INTERACTION_DELTA = -5;

const router = Router();

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const interactSchema = z
  .object({
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
    /** Transaction amount (required when createIntent is true) */
    amount: z.number().positive().optional(),
    /** Currency code — defaults to "USDC" */
    currency: z.string().max(10).optional().default('USDC'),
    /** When true, fetch toAgent trust score from the reputation graph */
    trustCheck: z.boolean().optional().default(false),
    /**
     * When true, create a coordination intent via IntentCoordinatorAgent.
     * Requires `amount` to be present — missing amount is a hard 400 failure,
     * not a soft warning, because the caller explicitly requested something
     * that cannot succeed without the missing field.
     */
    createIntent: z.boolean().optional().default(false),
    /** Arbitrary caller-supplied metadata, attached to the intent if created */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((data, ctx) => {
    // Hard-fail: createIntent without amount is an impossible payload.
    if (data.createIntent && data.amount == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'amount is required when createIntent is true',
      });
    }
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
  // Step 1 — Identity record lookup (both agents)
  //
  // IMPORTANT: identityFound = "we have a record for this agent"
  //            identityVerified = "the agent has at least one active,
  //                               non-expired verification credential"
  //
  // These are distinct concepts. External agents must not assume that
  // identityFound=true implies any cryptographic verification has occurred.
  // ------------------------------------------------------------------
  let fromAgentIdentityFound = false;
  let fromAgentIdentityVerified = false;
  let fromAgentTrustLevel = 'unverified';

  let toAgentIdentityFound = false;
  let toAgentIdentityVerified = false;
  let toAgentTrustLevel = 'unverified';

  try {
    const identity = await identityVerifierAgent.getIdentityRecord(fromAgentId);
    fromAgentIdentityFound = true;
    fromAgentIdentityVerified = identity.verified;
    fromAgentTrustLevel = identity.trustLevel;
  } catch (err: any) {
    warnings.push(`fromAgent identity lookup unavailable: ${err.message}`);
  }

  try {
    const identity = await identityVerifierAgent.getIdentityRecord(toAgentId);
    toAgentIdentityFound = true;
    toAgentIdentityVerified = identity.verified;
    toAgentTrustLevel = identity.trustLevel;
  } catch (err: any) {
    warnings.push(`toAgent identity lookup unavailable: ${err.message}`);
  }

  // ------------------------------------------------------------------
  // Step 2 — Trust / oracle lookup (optional, soft-fail)
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
  // Step 3 — Record interaction in the canonical trust event pipeline
  //
  // Uses recordTrustEvent() from trustEventService — the same canonical
  // service used by all other trust-writing operations in the system.
  // No side-channel. No parallel taxonomy.
  //
  // Richer semantics are preserved via:
  //   • counterpartyId  — toAgentId, so the event graph captures both sides
  //   • extraMetadata   — interactionType, service, outcome, trustCheck,
  //                       createIntent, interactionId are all recorded in the
  //                       event's metadata field, not collapsed to success/failure
  // ------------------------------------------------------------------
  const trustCategory =
    outcome === 'success' ? 'successful_interaction' : 'failed_interaction';

  const trustEventExtraMetadata: Record<string, unknown> = {
    interactionId,
    interactionType,
    outcome,
    ...(service ? { service } : {}),
    trustCheckPerformed: trustCheck,
    intentCreationRequested: createIntent,
  };

  let trustEventResult: { score: number; grade: string } | null = null;
  try {
    trustEventResult = await recordTrustEvent(
      fromAgentId,
      trustCategory,
      `${interactionType} with ${toAgentId}${service ? ` (${service})` : ''}`,
      toAgentId,
      trustEventExtraMetadata,
    );
  } catch (err: any) {
    warnings.push(`Trust event recording failed: ${err.message}`);
  }

  // ------------------------------------------------------------------
  // Step 4 — Intent coordination (optional, soft-fail)
  // Prerequisite validation (createIntent without amount) is already a
  // hard-fail enforced in the Zod schema above, so we can proceed safely.
  // ------------------------------------------------------------------
  let intent: object | null = null;
  if (createIntent && amount != null) {
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

  // ------------------------------------------------------------------
  // Collect emitted trust events for the response
  // ------------------------------------------------------------------
  const emittedEvents = trustEventResult
    ? [
        {
          category: trustCategory,
          agentId: fromAgentId,
          counterpartyId: toAgentId,
          delta: outcome === 'success' ? SUCCESSFUL_INTERACTION_DELTA : FAILED_INTERACTION_DELTA,
          score: trustEventResult.score,
          grade: trustEventResult.grade,
          metadata: trustEventExtraMetadata,
        },
      ]
    : [];

  logger.info('Agent interaction recorded', {
    interactionId,
    fromAgentId,
    toAgentId,
    interactionType,
    outcome,
    trustCheck,
    createIntent,
    merchantId: req.merchant?.id,
  });

  res.status(200).json({
    success: true,
    interactionId,
    fromAgent: {
      agentId: fromAgentId,
      /**
       * identityFound: a record for this agent exists in our system.
       * This does NOT imply cryptographic verification has occurred.
       */
      identityFound: fromAgentIdentityFound,
      /**
       * identityVerified: the agent has at least one active, non-expired
       * verification credential — a stronger trust signal than identityFound.
       */
      identityVerified: fromAgentIdentityVerified,
      trustLevel: fromAgentTrustLevel,
    },
    toAgent: {
      agentId: toAgentId,
      identityFound: toAgentIdentityFound,
      identityVerified: toAgentIdentityVerified,
      trustLevel: toAgentTrustLevel,
      ...(trustCheck ? { trustScore: toAgentTrustScore } : {}),
    },
    interaction: {
      type: interactionType,
      service: service ?? null,
      outcome,
      ...(amount != null ? { amount, currency: currency ?? 'USDC' } : {}),
      trustCheckPerformed: trustCheck,
      intentCreated: intent !== null,
      metadata: metadata ?? null,
    },
    intent,
    emittedEvents,
    warnings,
  });
});

export default router;
