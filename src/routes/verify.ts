/**
 * GET /api/verify/:txHash
 *
 * Settlement-aware verification endpoint.
 *
 * Lookup chain (executed in order, early-exit on first hit):
 *   1. settlement_events     — query by external_ref (txHash / proofId)
 *   2. intent_resolutions    — query by intent_id from step 1
 *   3. payment_intents       — query by intent_id for merchant/agent context
 *   4. transactions          — legacy fallback when no settlement event exists
 *
 * Response status values:
 *   unseen    — proofId not found anywhere
 *   observed  — settlement event found (hash_submitted) but not confirmed
 *   matched   — on-chain / webhook confirmed; resolution engine not yet run
 *   confirmed — resolution_status = 'confirmed' OR legacy tx confirmed
 *   unmatched — resolution engine rejected, or policy_mismatch event seen
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { query } from '../db/index.js';
import { logger } from '../logger.js';

const router = Router();

// Valid transaction hashes: relaxed alphanumeric pattern covering Solana base58 and EVM hex formats
const TX_HASH_PATTERN = /^[a-zA-Z0-9]{16,128}$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type VerificationStatus = 'unseen' | 'observed' | 'matched' | 'confirmed' | 'unmatched';

interface DerivedVerification {
  verified: boolean;
  status: VerificationStatus;
  reasonCode: string | null;
  intentId: string | null;
  merchantId: string | null;
  agentId: string | null;
  settlementTimestamp: string | null;
}

// ---------------------------------------------------------------------------
// SQL helpers — best-effort, never throw
// ---------------------------------------------------------------------------

async function querySettlementEvent(txHash: string) {
  try {
    const result = await query(
      `SELECT id                      AS "eventId",
              intent_id               AS "intentId",
              event_type              AS "eventType",
              protocol,
              payload,
              created_at              AS "createdAt"
       FROM   settlement_events
       WHERE  external_ref = $1
       ORDER  BY created_at DESC
       LIMIT  1`,
      [txHash],
    );
    return result.rows[0] ?? null;
  } catch {
    return null;
  }
}

async function queryIntentResolution(intentId: string) {
  try {
    const result = await query(
      `SELECT id                AS "resolutionId",
              resolution_status AS "resolutionStatus",
              decision_code     AS "decisionCode",
              reason_code       AS "reasonCode",
              confidence_score  AS "confidenceScore",
              resolved_at       AS "resolvedAt"
       FROM   intent_resolutions
       WHERE  intent_id = $1::uuid
       LIMIT  1`,
      [intentId],
    );
    return result.rows[0] ?? null;
  } catch {
    return null;
  }
}

async function queryPaymentIntent(intentId: string) {
  try {
    const result = await query(
      `SELECT id          AS "intentId",
              merchant_id AS "merchantId",
              agent_id    AS "agentId",
              status,
              created_at  AS "createdAt"
       FROM   payment_intents
       WHERE  id = $1::uuid
       LIMIT  1`,
      [intentId],
    );
    return result.rows[0] ?? null;
  } catch {
    return null;
  }
}

async function queryLegacyTransaction(txHash: string) {
  try {
    const result = await query(
      `SELECT id,
              merchant_id AS "merchantId",
              agent_id    AS "agentId",
              status,
              created_at  AS "createdAt"
       FROM   transactions
       WHERE  transaction_hash = $1
       LIMIT  1`,
      [txHash],
    );
    return result.rows[0] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pure status derivation (no I/O)
// ---------------------------------------------------------------------------

function deriveStatusFromEventType(eventType: string): VerificationStatus {
  switch (eventType) {
    case 'on_chain_confirmed':
    case 'webhook_received':
      return 'matched';
    case 'policy_mismatch':
    case 'resolution_failed':
      return 'unmatched';
    default:
      return 'observed';
  }
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function deriveVerification(
  event: Record<string, unknown> | null,
  resolution: Record<string, unknown> | null,
  intent: Record<string, unknown> | null,
  transaction: Record<string, unknown> | null,
): DerivedVerification {
  // 1. Resolution record exists → use resolution_status
  if (resolution !== null) {
    const resolved = resolution.resolutionStatus === 'confirmed';
    const status: VerificationStatus = resolved ? 'confirmed' : 'unmatched';
    const reasonCode =
      (resolution.reasonCode as string | null) ??
      (resolved ? null : (resolution.decisionCode as string | null));

    return {
      verified: resolved,
      status,
      reasonCode,
      intentId: (intent?.intentId as string) ?? null,
      merchantId: (intent?.merchantId as string) ?? null,
      agentId: (intent?.agentId as string) ?? null,
      settlementTimestamp: toIso(resolution.resolvedAt as string),
    };
  }

  // 2. Settlement event exists but no resolution yet
  if (event !== null) {
    const status = deriveStatusFromEventType(event.eventType as string);
    return {
      verified: false,
      status,
      reasonCode: status === 'unmatched' ? (event.eventType as string) : null,
      intentId: (intent?.intentId as string) ?? null,
      merchantId: (intent?.merchantId as string) ?? null,
      agentId: (intent?.agentId as string) ?? null,
      settlementTimestamp: toIso(event.createdAt as string),
    };
  }

  // 3. Legacy transaction found
  if (transaction !== null) {
    const verified = transaction.status === 'confirmed';
    return {
      verified,
      status: verified ? 'confirmed' : 'observed',
      reasonCode: null,
      intentId: transaction.id as string,
      merchantId: transaction.merchantId as string,
      agentId: (transaction.agentId as string) ?? null,
      settlementTimestamp: toIso(transaction.createdAt as string),
    };
  }

  // 4. Nothing found
  return {
    verified: false,
    status: 'unseen',
    reasonCode: null,
    intentId: null,
    merchantId: null,
    agentId: null,
    settlementTimestamp: null,
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

router.get('/:txHash', async (req: Request, res: Response) => {
  const { txHash } = req.params;

  if (!txHash || !TX_HASH_PATTERN.test(txHash)) {
    res.status(400).json({ error: 'Invalid or missing txHash format' });
    return;
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    logger.error('HMAC secret not configured for verify endpoint');
    res.status(500).json({ error: 'Server misconfiguration: HMAC secret not set' });
    return;
  }

  // ── Settlement lookup chain ───────────────────────────────────────────────
  const event = await querySettlementEvent(txHash);

  let resolution = null;
  let intent = null;

  const eventIntentId = typeof event?.intentId === 'string' ? event.intentId : null;
  if (event !== null && eventIntentId !== null) {
    [resolution, intent] = await Promise.all([
      queryIntentResolution(eventIntentId),
      queryPaymentIntent(eventIntentId),
    ]);
  }

  // Legacy fallback when no settlement event found
  const transaction = event === null ? await queryLegacyTransaction(txHash) : null;

  const derived = deriveVerification(event, resolution, intent, transaction);

  const payload = {
    verified: derived.verified,
    status: derived.status,
    intentId: derived.intentId,
    agentId: derived.agentId,
    merchantId: derived.merchantId,
    settlementTimestamp: derived.settlementTimestamp,
    reasonCode: derived.reasonCode,
  };

  const signature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  res.json({ ...payload, signature });
});

export default router;
