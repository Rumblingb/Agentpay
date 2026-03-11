/**
 * Webhook subscription routes — /api/webhooks/*
 *
 * Ports src/routes/webhooks.ts to Hono/Workers.
 *
 * Changes from Express:
 *   - No express/Joi/zod validators — inline validation
 *   - No pino logger — console.*
 *   - Inbound webhook HMAC verification ported from src/middleware/verifyWebhook.ts
 *     using SubtleCrypto (hmacSign + hmacVerify)
 *   - Raw body for inbound webhook read via c.req.text() (clean in Workers —
 *     no express.raw() middleware needed)
 *   - Inline SQL instead of webhookController service
 *   - WEBHOOK_SECRET from c.env instead of process.env
 *
 * Preserved:
 *   - All route paths and HTTP methods
 *   - Exact response shapes
 *   - Replay attack protection: ±5 minute timestamp window
 *   - HMAC scheme: HMAC-SHA256(timestamp + "." + rawBody, WEBHOOK_SECRET)
 *   - Timing-safe signature comparison via crypto.subtle.verify
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { createDb } from '../lib/db';
import { hmacVerify } from '../lib/hmac';

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // ±5 minutes
const ALLOWED_EVENT_TYPES = ['payment_verified'] as const;

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// POST /api/webhooks/subscribe
// Auth required. Creates a webhook subscription for the merchant.
// ---------------------------------------------------------------------------

router.post('/subscribe', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { url, eventTypes } = body as {
    url?: unknown;
    eventTypes?: unknown;
  };

  if (!url || typeof url !== 'string') {
    return c.json({ error: 'Validation error', details: ['url must be a valid URL'] }, 400);
  }
  try {
    new URL(url);
  } catch {
    return c.json({ error: 'Validation error', details: ['url must be a valid URL'] }, 400);
  }
  if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
    return c.json({ error: 'Validation error', details: ['eventTypes must contain at least one event type'] }, 400);
  }
  const invalid = (eventTypes as string[]).filter(
    (e) => !(ALLOWED_EVENT_TYPES as readonly string[]).includes(e),
  );
  if (invalid.length) {
    return c.json(
      { error: 'Validation error', details: [`Invalid event types: ${invalid.join(', ')}`] },
      400,
    );
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql<
      Array<{
        id: string;
        merchantId: string;
        url: string;
        eventTypes: string[];
        createdAt: Date;
      }>
    >`
      INSERT INTO webhook_subscriptions (id, merchant_id, url, event_types, created_at)
      VALUES (${crypto.randomUUID()}, ${merchant.id}, ${url}, ${eventTypes as string[]}, NOW())
      RETURNING id,
                merchant_id  AS "merchantId",
                url,
                event_types  AS "eventTypes",
                created_at   AS "createdAt"
    `;

    console.info('[webhooks] subscription created', { merchantId: merchant.id, subscriptionId: rows[0].id });
    return c.json({ success: true, subscription: rows[0] }, 201);
  } catch (err: unknown) {
    console.error('[webhooks] subscribe error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to create subscription' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// GET /api/webhooks
// Auth required. Lists all webhook subscriptions for the merchant.
// ---------------------------------------------------------------------------

router.get('/', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const sql = createDb(c.env);
  try {
    const subscriptions = await sql`
      SELECT id,
             merchant_id AS "merchantId",
             url,
             event_types AS "eventTypes",
             created_at  AS "createdAt"
      FROM webhook_subscriptions
      WHERE merchant_id = ${merchant.id}
      ORDER BY created_at DESC
    `;
    return c.json({ success: true, subscriptions });
  } catch (err: unknown) {
    console.error('[webhooks] list error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to list subscriptions' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/webhooks/:id
// Auth required. Deletes a webhook subscription (ownership enforced).
// ---------------------------------------------------------------------------

router.delete('/:id', authenticateApiKey, async (c) => {
  const merchant = c.get('merchant');
  const { id } = c.req.param();

  const sql = createDb(c.env);
  try {
    const result = await sql`
      DELETE FROM webhook_subscriptions
      WHERE id = ${id}
        AND merchant_id = ${merchant.id}
    `;

    if (!result.count) {
      return c.json({ error: 'Subscription not found' }, 404);
    }

    console.info('[webhooks] subscription deleted', { merchantId: merchant.id, subscriptionId: id });
    return c.json({ success: true });
  } catch (err: unknown) {
    console.error('[webhooks] delete error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to delete subscription' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/inbound
// No auth — verified via HMAC-SHA256 signature in x-agentpay-signature header.
//
// Port of src/middleware/verifyWebhook.ts verifyWebhookSignature():
//   Signature = HMAC-SHA256(timestamp + "." + rawBody, WEBHOOK_SECRET)
//   Replay window: ±5 minutes
//
// Raw body handling in Workers: c.req.text() reads the body once before any
// JSON parsing — no express.raw() workaround needed.
// ---------------------------------------------------------------------------

router.post('/inbound', async (c) => {
  const signature = c.req.header('x-agentpay-signature');
  const timestamp = c.req.header('x-agentpay-timestamp');

  if (!signature || !timestamp) {
    return c.json(
      {
        error: 'WEBHOOK_SIGNATURE_MISSING',
        message: 'x-agentpay-signature and x-agentpay-timestamp headers are required',
      },
      401,
    );
  }

  // Replay window check
  const tsMs = Number(timestamp) * 1000;
  if (Number.isNaN(tsMs)) {
    return c.json(
      {
        error: 'WEBHOOK_TIMESTAMP_INVALID',
        message: 'x-agentpay-timestamp must be a Unix timestamp in seconds',
      },
      401,
    );
  }

  const drift = Math.abs(Date.now() - tsMs);
  if (drift > REPLAY_WINDOW_MS) {
    return c.json(
      {
        error: 'WEBHOOK_REPLAY_DETECTED',
        message: `Timestamp is outside the ±5 minute replay window (drift: ${Math.round(drift / 1000)}s)`,
      },
      401,
    );
  }

  // Read raw body BEFORE any JSON parsing — identical bytes that were signed.
  const rawBody = await c.req.text();
  const signedData = `${timestamp}.${rawBody}`;

  const isValid = await hmacVerify(signedData, signature, c.env.WEBHOOK_SECRET);
  if (!isValid) {
    console.warn('[webhooks/inbound] signature mismatch');
    return c.json(
      { error: 'WEBHOOK_SIGNATURE_INVALID', message: 'Webhook signature does not match' },
      401,
    );
  }

  let parsed: { event?: string; payload?: unknown } = {};
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    // Malformed JSON — acknowledge but log
    console.warn('[webhooks/inbound] body is not valid JSON');
  }

  console.info('[webhooks/inbound] event received', { event: parsed.event ?? 'unknown' });
  return c.json({ success: true, received: true, event: parsed.event ?? 'unknown' });
});

export { router as webhooksRouter };
