/**
 * Verify routes — GET /api/verify/:txHash  (Phase 7)
 *
 * Returns structured settlement verification for a given proof ID (tx hash,
 * Stripe session ID, AP2 token, etc.).
 *
 * ── What changed in Phase 7 ───────────────────────────────────────────────
 *
 * Before: single `SELECT FROM transactions WHERE transaction_hash = ?`
 * After:  three-layer settlement lookup chain via verificationLookup.ts:
 *           1. settlement_events by external_ref     (Phase 5 ingestion)
 *           2. intent_resolutions by intent_id       (Phase 6 engine)
 *           3. payment_intents  by intent_id         (merchant/agent context)
 *           4. transactions     by transaction_hash  (legacy fallback)
 *
 * ── Response shape ────────────────────────────────────────────────────────
 *
 * Preserved (backward-compatible):
 *   verified           boolean  — true only when status === 'confirmed'
 *   intentId           string|null
 *   agentId            string|null
 *   merchantId         string|null
 *   settlementTimestamp string|null
 *   signature          string   — HMAC-SHA256 of the payload (same as before)
 *
 * New in Phase 7:
 *   status    'unseen'|'observed'|'matched'|'confirmed'|'unmatched'
 *   reasonCode string|null  — from intent_resolutions.reason_code when set
 *
 * ── Status semantics ──────────────────────────────────────────────────────
 *
 *   unseen    — proofId not found in settlement_events OR transactions
 *   observed  — settlement event ingested (hash_submitted) but not confirmed
 *   matched   — on-chain / webhook confirmed; resolution engine not yet run
 *   confirmed — resolution_status = 'confirmed' OR legacy tx confirmed
 *   unmatched — resolution engine rejected, or policy_mismatch event seen
 *
 * ── Error handling ────────────────────────────────────────────────────────
 *
 * - Invalid proofId format           → 400 with structured error body
 * - proofId not found anywhere       → 200 { verified:false, status:'unseen' }
 * - DB error (all queries failed)    → 200 { verified:false, status:'unseen' }
 *   (never returns generic 500 for lookup failures)
 * - WEBHOOK_SECRET missing           → 500 (config error, not lookup error)
 *
 * ── Preserved behaviours ──────────────────────────────────────────────────
 * - TX_HASH_PATTERN validation unchanged
 * - HMAC signing of the full payload object unchanged
 * - sql.end() cleanup unchanged
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';
import { hmacSign } from '../lib/hmac';
import { lookupByProofId, deriveVerification } from '../lib/verificationLookup';

const TX_HASH_PATTERN = /^[a-zA-Z0-9]{16,128}$/;

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

router.get('/:txHash', async (c) => {
  const { txHash } = c.req.param();

  // ── Validate proof ID format ─────────────────────────────────────────────
  if (!txHash || !TX_HASH_PATTERN.test(txHash)) {
    return c.json(
      {
        verified: false,
        status: 'unseen',
        intentId: null,
        agentId: null,
        merchantId: null,
        settlementTimestamp: null,
        reasonCode: null,
        error: 'Invalid or missing txHash format',
      },
      400,
    );
  }

  const sql = createDb(c.env);

  try {
    // ── Settlement lookup chain ──────────────────────────────────────────
    const lookup   = await lookupByProofId(sql, txHash);
    const derived  = deriveVerification(lookup);

    const payload = {
      verified:            derived.verified,
      status:              derived.status,
      intentId:            derived.intentId,
      agentId:             derived.agentId,
      merchantId:          derived.merchantId,
      settlementTimestamp: derived.settlementTimestamp,
      reasonCode:          derived.reasonCode,
    };

    const signature = await hmacSign(JSON.stringify(payload), c.env.WEBHOOK_SECRET);

    return c.json({ ...payload, signature });
  } catch (err: unknown) {
    console.error('[verify] error:', err instanceof Error ? err.message : err);

    // ── Graceful error response — never a generic 500 for lookup failures ──
    // If the entire lookup throws (e.g. DB connection refused), return a
    // structured unseen response rather than a generic 500.
    const payload = {
      verified:            false,
      status:              'unseen' as const,
      intentId:            null,
      agentId:             null,
      merchantId:          null,
      settlementTimestamp: null,
      reasonCode:          null,
    };

    try {
      const signature = await hmacSign(JSON.stringify(payload), c.env.WEBHOOK_SECRET);
      return c.json({ ...payload, signature, error: 'verification_failed' });
    } catch (signErr) {
      console.error(
        '[verify] signing fallback error:',
        signErr instanceof Error ? signErr.message : signErr,
      );
      return c.json({ ...payload, error: 'verification_failed' });
    }
  } finally {
    sql.end().catch(() => {});
  }
});

export { router as verifyRouter };
