/**
 * Airwallex webhook route — POST /webhooks/airwallex
 *
 * Verifies Airwallex webhook signatures and processes payment status changes.
 *
 * Signature scheme (Airwallex docs):
 *   HMAC-SHA256(timestamp + rawBody, AIRWALLEX_WEBHOOK_SECRET)
 *   Headers: x-timestamp (Unix ms), x-signature (hex)
 *   Replay window: ±5 minutes
 *
 * On payment_intent.status_changed where status === 'SUCCEEDED':
 *   - Finds the payment_intents row by airwallexIntentId in metadata
 *   - Updates status to 'payment_confirmed' and sets paymentConfirmedAt
 *   - Fires Make.com operations webhook for the ops sheet
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // ±5 minutes
const enc = new TextEncoder();

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Signature verification helpers
// ---------------------------------------------------------------------------

async function verifyAirwallexSignature(
  timestamp: string,
  rawBody: string,
  signatureHex: string,
  secret: string,
): Promise<boolean> {
  // Guard: must be lowercase hex (variable length — Airwallex may use 64 chars)
  if (!/^[0-9a-f]{1,}$/i.test(signatureHex)) return false;

  let sigBytes: Uint8Array;
  try {
    const pairs = signatureHex.match(/.{2}/g);
    if (!pairs) return false;
    sigBytes = new Uint8Array(pairs.map((h) => parseInt(h, 16)));
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

  const signedData = `${timestamp}${rawBody}`;
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(signedData));
}

// ---------------------------------------------------------------------------
// POST /webhooks/airwallex
// ---------------------------------------------------------------------------

router.post('/', async (c) => {
  if (!c.env.AIRWALLEX_WEBHOOK_SECRET) {
    console.warn('[airwallex-webhook] AIRWALLEX_WEBHOOK_SECRET not configured');
    return c.json({ error: 'Webhook not configured' }, 503);
  }

  const timestamp = c.req.header('x-timestamp');
  const signature = c.req.header('x-signature');

  if (!timestamp || !signature) {
    return c.json(
      { error: 'WEBHOOK_HEADERS_MISSING', message: 'x-timestamp and x-signature are required' },
      400,
    );
  }

  // Replay window check
  const tsMs = Number(timestamp);
  if (Number.isNaN(tsMs)) {
    return c.json({ error: 'WEBHOOK_TIMESTAMP_INVALID', message: 'x-timestamp must be numeric milliseconds' }, 400);
  }
  const drift = Math.abs(Date.now() - tsMs);
  if (drift > REPLAY_WINDOW_MS) {
    return c.json(
      {
        error: 'WEBHOOK_REPLAY_DETECTED',
        message: `Timestamp outside ±5 minute replay window (drift: ${Math.round(drift / 1000)}s)`,
      },
      400,
    );
  }

  // Read raw body BEFORE any JSON parsing
  const rawBody = await c.req.text();

  const isValid = await verifyAirwallexSignature(
    timestamp,
    rawBody,
    signature,
    c.env.AIRWALLEX_WEBHOOK_SECRET,
  );

  if (!isValid) {
    console.warn('[airwallex-webhook] signature mismatch');
    return c.json({ error: 'WEBHOOK_SIGNATURE_INVALID', message: 'Webhook signature does not match' }, 400);
  }

  // Parse event
  let event: {
    name?: string;
    data?: {
      object?: {
        id?: string;
        status?: string;
        merchant_order_id?: string;
      };
    };
  } = {};
  try {
    event = JSON.parse(rawBody);
  } catch {
    console.warn('[airwallex-webhook] body is not valid JSON');
    return c.json({ success: true, received: true, note: 'non-JSON body acknowledged' });
  }

  const eventName = event.name ?? '';
  const intentObj = event.data?.object;

  console.info('[airwallex-webhook] event received', { name: eventName, intentId: intentObj?.id });

  // Only handle payment_intent.status_changed with SUCCEEDED status
  if (eventName !== 'payment_intent.status_changed' || intentObj?.status !== 'SUCCEEDED') {
    return c.json({ success: true, received: true, handled: false });
  }

  const airwallexIntentId = intentObj.id;
  if (!airwallexIntentId) {
    console.warn('[airwallex-webhook] missing intent id in event');
    return c.json({ success: true, received: true, handled: false });
  }

  const sql = createDb(c.env);
  try {
    // Find the payment_intents row where metadata->>'airwallexIntentId' matches
    const rows = await sql<Array<{ id: string }>>`
      SELECT id
      FROM payment_intents
      WHERE metadata->>'airwallexIntentId' = ${airwallexIntentId}
      LIMIT 1
    `;

    if (!rows.length) {
      console.warn('[airwallex-webhook] no payment_intent row found for airwallexIntentId', { airwallexIntentId });
      return c.json({ success: true, received: true, handled: false, note: 'intent not found' });
    }

    const intentRow = rows[0];

    // Update status and set paymentConfirmedAt in metadata
    await sql`
      UPDATE payment_intents
      SET
        status   = 'payment_confirmed',
        metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{paymentConfirmedAt}',
          to_jsonb(NOW()::text)
        ),
        updated_at = NOW()
      WHERE id = ${intentRow.id}
    `;

    console.info('[airwallex-webhook] payment confirmed', { intentId: intentRow.id, airwallexIntentId });

    // Fire Make.com operations webhook (non-blocking)
    if (c.env.MAKECOM_WEBHOOK_URL) {
      c.executionCtx.waitUntil(
        fetch(c.env.MAKECOM_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'airwallex_payment_confirmed',
            intentId: intentRow.id,
            airwallexIntentId,
            merchantOrderId: intentObj.merchant_order_id ?? null,
            confirmedAt: new Date().toISOString(),
          }),
        }).catch((e: unknown) =>
          console.warn('[airwallex-webhook] makecom fire failed', { error: (e as Error).message }),
        ),
      );
    }

    return c.json({ success: true, received: true, handled: true, intentId: intentRow.id });
  } catch (err: unknown) {
    console.error('[airwallex-webhook] db error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to process event' }, 500);
  } finally {
    sql.end().catch(() => {});
  }
});

export { router as airwallexWebhooksRouter };
