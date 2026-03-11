/**
 * Receipt routes — GET /api/receipt/:intentId
 *
 * Ports src/routes/receipt.ts to Hono/Workers.
 *
 * Phase 8: The response now includes two additional top-level fields:
 *
 *   resolution — Phase 6 engine output (null until engine runs):
 *     { status, decisionCode, reasonCode, confidenceScore, resolvedAt,
 *       resolvedBy, protocol, externalRef }
 *
 *   settlement — most-recent settlement_identity for the intent (null if none):
 *     { status, protocol, externalRef, settledAt }
 *
 * Changes from Express:
 *   - No Prisma — raw SQL via postgres.js
 *   - No express-rate-limit (in-memory, not Workers-compatible)
 *     Rate limiting is handled at the Cloudflare zone level.
 *   - sanitizeIntent is inlined (pure function, no dependencies)
 *   - Agent join: done via LEFT JOIN instead of Prisma nested select
 *   - Resolution + settlement: separate best-effort queries (nullable)
 *
 * Preserved:
 *   - Route path: GET /api/receipt/:intentId
 *   - Response shape: { success: true, intent: {...}, resolution, settlement, escrow: null }
 *   - verificationToken is NOT included in the response (security)
 *   - sanitizeIntent removes verificationToken, metadata.internal,
 *     merchant.walletAddress, merchant.apiKeyHash
 *
 * Backward compatibility: all pre-Phase-8 fields remain unchanged.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Mirrors src/utils/sanitizeIntent.ts exactly — pure function, no deps. */
function sanitizeIntent(intent: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...intent };
  delete sanitized.verificationToken;

  if (sanitized.metadata && typeof sanitized.metadata === 'object') {
    const meta = { ...(sanitized.metadata as Record<string, unknown>) };
    delete meta['internal'];
    sanitized.metadata = meta;
  }

  if (sanitized.merchant && typeof sanitized.merchant === 'object') {
    const merchant = { ...(sanitized.merchant as Record<string, unknown>) };
    delete merchant['walletAddress'];
    delete merchant['apiKeyHash'];
    sanitized.merchant = merchant;
  }

  return sanitized;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface IntentRow {
  id: string;
  amount: number;
  currency: string;
  status: string;
  protocol: string | null;
  agentId: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  agentDisplayName: string | null;
  agentRiskScore: number | null;
}

interface ResolutionRow {
  resolutionStatus: string;
  decisionCode: string | null;
  reasonCode: string | null;
  confidenceScore: unknown;
  resolvedAt: Date;
  resolvedBy: string;
  protocol: string;
  externalRef: string | null;
}

interface SettlementIdentityRow {
  status: string;
  protocol: string;
  externalRef: string | null;
  settledAt: Date | null;
}

// ---------------------------------------------------------------------------
// Best-effort SQL helpers
// ---------------------------------------------------------------------------

/**
 * Query intent_resolutions for a given intent.
 * Returns null if no resolution exists or on any DB error.
 */
async function queryResolution(
  sql: ReturnType<typeof createDb>,
  intentId: string,
): Promise<ResolutionRow | null> {
  try {
    const rows = await sql<ResolutionRow[]>`
      SELECT resolution_status  AS "resolutionStatus",
             decision_code      AS "decisionCode",
             reason_code        AS "reasonCode",
             confidence_score   AS "confidenceScore",
             resolved_at        AS "resolvedAt",
             resolved_by        AS "resolvedBy",
             protocol,
             external_ref       AS "externalRef"
      FROM   intent_resolutions
      WHERE  intent_id = ${intentId}::uuid
      LIMIT  1
    `;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Query settlement_identities for the most-recent identity linked to an intent.
 * Returns null if none exists or on any DB error.
 */
async function querySettlementIdentity(
  sql: ReturnType<typeof createDb>,
  intentId: string,
): Promise<SettlementIdentityRow | null> {
  try {
    const rows = await sql<SettlementIdentityRow[]>`
      SELECT status,
             protocol,
             external_ref  AS "externalRef",
             settled_at    AS "settledAt"
      FROM   settlement_identities
      WHERE  intent_id = ${intentId}::uuid
      ORDER  BY created_at DESC
      LIMIT  1
    `;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

router.get('/:intentId', async (c) => {
  const { intentId } = c.req.param();

  const sql = createDb(c.env);
  try {
    const rows = await sql<IntentRow[]>`
      SELECT pi.id,
             pi.amount,
             pi.currency,
             pi.status,
             pi.protocol,
             pi.agent_id          AS "agentId",
             pi.expires_at        AS "expiresAt",
             pi.created_at        AS "createdAt",
             pi.updated_at        AS "updatedAt",
             a.display_name       AS "agentDisplayName",
             a.risk_score         AS "agentRiskScore"
      FROM payment_intents pi
      LEFT JOIN agents a ON a.id = pi.agent_id
      WHERE pi.id = ${intentId}
    `;

    if (!rows.length) {
      return c.json({ error: 'NOT_FOUND', message: 'Payment intent not found' }, 404);
    }

    const row = rows[0];

    // Phase 8: fetch resolution + settlement identity in parallel (best-effort).
    const [resolutionRow, settlementRow] = await Promise.all([
      queryResolution(sql, intentId),
      querySettlementIdentity(sql, intentId),
    ]);

    const intentPayload: Record<string, unknown> = {
      id: row.id,
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status,
      protocol: row.protocol ?? null,
      agentId: row.agentId ?? null,
      // verificationToken intentionally omitted (sensitive internal token)
      expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
      agent: row.agentId
        ? {
            id: row.agentId,
            displayName: row.agentDisplayName ?? null,
            riskScore: row.agentRiskScore ?? null,
          }
        : null,
    };

    // Phase 8: resolution payload (null until Phase 6 engine has run).
    const resolutionPayload = resolutionRow
      ? {
          status: resolutionRow.resolutionStatus,
          decisionCode: resolutionRow.decisionCode ?? null,
          reasonCode: resolutionRow.reasonCode ?? null,
          confidenceScore:
            resolutionRow.confidenceScore !== null &&
            resolutionRow.confidenceScore !== undefined
              ? Number(resolutionRow.confidenceScore)
              : null,
          resolvedAt:
            resolutionRow.resolvedAt instanceof Date
              ? resolutionRow.resolvedAt.toISOString()
              : resolutionRow.resolvedAt,
          resolvedBy: resolutionRow.resolvedBy,
          protocol: resolutionRow.protocol,
          externalRef: resolutionRow.externalRef ?? null,
        }
      : null;

    // Phase 8: settlement identity payload (null if no proof submitted yet).
    const settlementPayload = settlementRow
      ? {
          status: settlementRow.status,
          protocol: settlementRow.protocol,
          externalRef: settlementRow.externalRef ?? null,
          settledAt:
            settlementRow.settledAt instanceof Date
              ? settlementRow.settledAt.toISOString()
              : (settlementRow.settledAt ?? null),
        }
      : null;

    return c.json({
      success: true,
      intent: sanitizeIntent(intentPayload),
      resolution: resolutionPayload,
      settlement: settlementPayload,
      escrow: null,
    });
  } catch (err: unknown) {
    console.error('[receipt] error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to fetch receipt' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

export { router as receiptRouter };
