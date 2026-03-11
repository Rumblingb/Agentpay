/**
 * Receipt routes — GET /api/receipt/:intentId
 *
 * Ports src/routes/receipt.ts to Hono/Workers.
 *
 * Changes from Express:
 *   - No Prisma — raw SQL via postgres.js
 *   - No express-rate-limit (in-memory, not Workers-compatible)
 *     Rate limiting is handled at the Cloudflare zone level.
 *   - sanitizeIntent is inlined (pure function, no dependencies)
 *   - Agent join: done via LEFT JOIN instead of Prisma nested select
 *
 * Preserved:
 *   - Route path: GET /api/receipt/:intentId
 *   - Response shape: { success: true, intent: {...}, escrow: null }
 *   - verificationToken is NOT included in the response (security)
 *   - sanitizeIntent removes verificationToken, metadata.internal,
 *     merchant.walletAddress, merchant.apiKeyHash
 *
 * Deferred:
 *   - agent.riskScore — column name TBC; returns null if query fails
 *   - escrow data — always null for now (deferred per original code comment)
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

router.get('/:intentId', async (c) => {
  const { intentId } = c.req.param();

  const sql = createDb(c.env);
  try {
    const rows = await sql<
      Array<{
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
      }>
    >`
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

    return c.json({
      success: true,
      intent: sanitizeIntent(intentPayload),
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
