/**
 * paymentsUpi — UPI payment routes
 *
 * POST /api/payments/upi/create  — create Razorpay UPI payment link
 * POST /webhooks/razorpay        — Razorpay payment confirmation webhook
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { createUpiPaymentLink, verifyRazorpayWebhook } from '../lib/razorpay';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// POST /api/payments/upi/create
// Auth: merchant API key.
// Body: { amountInr, description, receipt, customerName?, customerPhone?, customerEmail? }
// ---------------------------------------------------------------------------

router.post('/create', authenticateApiKey, async (c) => {
  if (!c.env.RAZORPAY_KEY_ID || !c.env.RAZORPAY_KEY_SECRET) {
    return c.json(
      {
        error: 'UPI_NOT_CONFIGURED',
        message: 'Razorpay is not configured on this instance. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
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
    const result = await createUpiPaymentLink(c.env, {
      amountInr,
      description,
      receipt,
      customerName:  typeof customerName  === 'string' ? customerName  : undefined,
      customerPhone: typeof customerPhone === 'string' ? customerPhone : undefined,
      customerEmail: typeof customerEmail === 'string' ? customerEmail : undefined,
    });

    console.info('[paymentsUpi] payment link created', {
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

    console.info('[razorpay-webhook] payment_link.paid confirmed', {
      paymentLinkId: paymentLinkId ?? 'unknown',
      paymentId:     paymentId     ?? 'unknown',
    });

    // TODO Phase 2: update job status to 'paid', trigger booking confirmation flow
  }

  return c.json({ success: true, received: true, event: eventName ?? 'unknown' });
});

export { router as paymentsUpiRouter };
