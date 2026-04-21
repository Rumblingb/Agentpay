/**
 * paymentsUpi — UPI payment routes
 *
 * POST /api/payments/upi/create  — create Razorpay UPI payment link
 * POST /webhooks/razorpay        — Razorpay payment confirmation webhook
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { verifyRazorpayWebhook } from '../lib/razorpay';
import { createDb } from '../lib/db';
import { dispatchToOpenClaw } from '../lib/openclaw';
import { createHostedUpiPayment, selectFiatProvider } from '../lib/fiatPayments';
import { withBookingState } from '../lib/bookingState';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// POST /api/payments/upi/create
// Auth: merchant API key.
// Body: { amountInr, description, receipt, customerName?, customerPhone?, customerEmail? }
// ---------------------------------------------------------------------------

router.post('/create', authenticateApiKey, async (c) => {
  if (selectFiatProvider(c.env, 'upi_link') !== 'razorpay') {
    return c.json(
      {
        error: 'UPI_NOT_CONFIGURED',
        message: 'No hosted UPI provider is configured on this instance.',
      },
      503,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { amountInr, description, receipt, customerName, customerPhone, customerEmail } = body as {
    amountInr?:     unknown;
    description?:   unknown;
    receipt?:       unknown;
    customerName?:  unknown;
    customerPhone?: unknown;
    customerEmail?: unknown;
  };

  if (typeof amountInr !== 'number' || amountInr <= 0) {
    return c.json({ error: 'Validation error', details: ['amountInr must be a positive number'] }, 400);
  }
  if (!description || typeof description !== 'string') {
    return c.json({ error: 'Validation error', details: ['description is required'] }, 400);
  }
  if (!receipt || typeof receipt !== 'string') {
    return c.json({ error: 'Validation error', details: ['receipt is required'] }, 400);
  }

  try {
    const result = await createHostedUpiPayment(c.env, {
      amountInr,
      description,
      receipt,
      customerName:  typeof customerName  === 'string' ? customerName  : undefined,
      customerPhone: typeof customerPhone === 'string' ? customerPhone : undefined,
      customerEmail: typeof customerEmail === 'string' ? customerEmail : undefined,
    });
    if (!result) {
      return c.json({ error: 'Failed to create hosted UPI payment' }, 502);
    }

    console.info('[paymentsUpi] payment link created', {
      provider: result.provider,
      paymentLinkId: result.paymentLinkId,
      amountInr,
      receipt,
    });

    return c.json({ ...result, amountInr }, 201);
  } catch (err: unknown) {
    console.error('[paymentsUpi] create error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to create UPI payment link' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /webhooks/razorpay  (mounted at root — no prefix in this router)
// No auth — verified by HMAC-SHA256 signature in X-Razorpay-Signature header.
// ---------------------------------------------------------------------------

router.post('/', async (c) => {
  const signature = c.req.header('x-razorpay-signature');

  if (!signature) {
    console.warn('[razorpay-webhook] missing X-Razorpay-Signature header');
    return c.json({ error: 'Missing signature header' }, 400);
  }

  if (!c.env.RAZORPAY_WEBHOOK_SECRET) {
    console.error('[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET not set — cannot verify');
    return c.json({ error: 'Webhook secret not configured' }, 503);
  }

  // Read raw body before any JSON parsing — must match what Razorpay signed
  const rawBody = await c.req.text();

  const isValid = await verifyRazorpayWebhook(c.env.RAZORPAY_WEBHOOK_SECRET, rawBody, signature);
  if (!isValid) {
    console.warn('[razorpay-webhook] signature mismatch');
    return c.json({ error: 'Invalid signature' }, 401);
  }

  let event: Record<string, unknown> = {};
  try {
    event = JSON.parse(rawBody);
  } catch {
    console.warn('[razorpay-webhook] body is not valid JSON');
    return c.json({ success: true, received: true });
  }

  const eventName = event.event as string | undefined;
  console.info('[razorpay-webhook] event received', { event: eventName ?? 'unknown' });

  // Handle payment_link.paid — payment confirmed
  if (eventName === 'payment_link.paid') {
    const payload = event.payload as Record<string, unknown> | undefined;
    const paymentLinkEntity = (payload?.payment_link as Record<string, unknown> | undefined)?.entity as Record<string, unknown> | undefined;
    const paymentEntity     = (payload?.payment     as Record<string, unknown> | undefined)?.entity as Record<string, unknown> | undefined;

    const paymentLinkId = paymentLinkEntity?.id  as string | undefined;
    const paymentId     = paymentEntity?.id       as string | undefined;
    const notes         = paymentLinkEntity?.notes as Record<string, unknown> | undefined;
    const referenceId   = paymentLinkEntity?.reference_id as string | undefined;
    const journeyId     = notes?.journeyId as string | undefined;
    const jobId         = (notes?.jobId as string | undefined) ?? referenceId;

    console.info('[razorpay-webhook] payment_link.paid confirmed', {
      paymentLinkId: paymentLinkId ?? 'unknown',
      paymentId:     paymentId     ?? 'unknown',
      jobId:         jobId         ?? 'unknown',
    });

    if (jobId) {
      const sql = createDb(c.env);
      try {
        const paidAt = new Date().toISOString();
        await sql`
          UPDATE payment_intents
          SET metadata = metadata || ${JSON.stringify({
            paymentConfirmed: true,
            paymentProvider: 'razorpay',
            paymentConfirmedAt: paidAt,
            razorpayPaymentConfirmed: true,
            razorpayPaidAt: paidAt,
            razorpayPaymentId: paymentId ?? null,
            razorpayPaymentLinkId: paymentLinkId ?? null,
            ...withBookingState('payment_confirmed'),
          })}::jsonb
          WHERE (
            id = ${jobId}
            OR (${journeyId ?? null} IS NOT NULL AND metadata->>'journeyId' = ${journeyId ?? ''})
          )
            AND metadata->>'protocol' = 'marketplace_hire'
        `;

        if (c.env.OPENCLAW_API_URL && c.env.OPENCLAW_API_KEY) {
          const jobRows = await sql<any[]>`
            SELECT id, metadata
            FROM payment_intents
            WHERE (
              id = ${jobId}
              OR (${journeyId ?? null} IS NOT NULL AND metadata->>'journeyId' = ${journeyId ?? ''})
            )
            LIMIT 10
          `.catch(() => []);

          for (const jobRow of jobRows) {
            const jobMeta = jobRow.metadata ?? {};
            const clawResult = await dispatchToOpenClaw(c.env, jobRow.id, jobMeta);
                const clawPatch = JSON.stringify({
                  openclawDispatched: clawResult.status === 'dispatched',
                  openclawJobId: clawResult.openclawJobId ?? null,
                  openclawDispatchedAt: clawResult.dispatchedAt,
                  openclawError: clawResult.error ?? null,
                  ...withBookingState(clawResult.status === 'dispatched' ? 'securing' : 'payment_confirmed'),
                });
            await sql`
              UPDATE payment_intents
              SET metadata = metadata || ${clawPatch}::jsonb
              WHERE id = ${jobRow.id}
            `.catch(() => {});
          }
        }
      } finally {
        await sql.end().catch(() => {});
      }
    }
  }

  return c.json({ success: true, received: true, event: eventName ?? 'unknown' });
});

export { router as paymentsUpiRouter };
