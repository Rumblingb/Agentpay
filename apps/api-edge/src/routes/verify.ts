/**
 * Verify routes — GET /api/verify/:txHash
 *
 * Ports src/routes/verify.ts to Hono/Workers.
 *
 * Changes from Express:
 *   - HMAC via hmacSign (SubtleCrypto) instead of crypto.createHmac
 *   - WEBHOOK_SECRET read from c.env (Workers binding) not process.env
 *   - Legacy AGENTPAY_HMAC_SECRET fallback is intentionally NOT included
 *     (removed in the Workers migration as per migration strategy)
 *   - Inline SQL instead of query() helper
 *
 * Preserved:
 *   - Exact response shape: { verified, intentId, agentId, merchantId,
 *     settlementTimestamp, signature }
 *   - Same TX_HASH_PATTERN validation
 *   - Same HMAC signing of the full payload object
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';
import { hmacSign } from '../lib/hmac';

const TX_HASH_PATTERN = /^[a-zA-Z0-9]{16,128}$/;

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

router.get('/:txHash', async (c) => {
  const { txHash } = c.req.param();

  if (!txHash || !TX_HASH_PATTERN.test(txHash)) {
    return c.json(
      {
        verified: false,
        intentId: null,
        agentId: null,
        merchantId: null,
        settlementTimestamp: null,
        error: 'Invalid or missing txHash format',
      },
      400,
    );
  }

  const sql = createDb(c.env);

  try {
    const rows = await sql<
      Array<{
        id: string;
        merchantId: string;
        agentId: string | null;
        status: string;
        createdAt: Date | string | null;
      }>
    >`
      SELECT id, merchant_id AS "merchantId", agent_id AS "agentId",
             status, created_at AS "createdAt"
      FROM transactions
      WHERE transaction_hash = ${txHash}
      LIMIT 1
    `;

    const row = rows[0] ?? null;
    const verified = row !== null && row.status === 'confirmed';

    const payload = {
      verified,
      intentId: row?.id ?? null,
      agentId: row?.agentId ?? null,
      merchantId: row?.merchantId ?? null,
      settlementTimestamp:
        row?.createdAt != null ? new Date(row.createdAt).toISOString() : null,
    };

    const signature = await hmacSign(JSON.stringify(payload), c.env.WEBHOOK_SECRET);

    return c.json({ ...payload, signature });
  } catch (err: unknown) {
    console.error('[verify] error:', err instanceof Error ? err.message : err);

    const payload = {
      verified: false,
      intentId: null,
      agentId: null,
      merchantId: null,
      settlementTimestamp: null,
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