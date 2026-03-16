/**
 * Webhook Signature Verification Middleware
 *
 * Validates inbound webhook calls using HMAC-SHA256 signatures to prevent
 * replay attacks and spoofed payloads.
 *
 * Expected request headers:
 *   x-agentpay-signature  — HMAC_SHA256(timestamp + "." + rawBody, WEBHOOK_SECRET)
 *   x-agentpay-timestamp  — Unix timestamp in seconds (string)
 *
 * Rejects with 401 when:
 *   - Either header is missing
 *   - Timestamp is outside the ±5 minute replay window
 *   - Computed signature does not match the provided signature
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // ±5 minutes

/**
 * Compute the expected HMAC-SHA256 signature for a webhook payload.
 *
 * @param timestamp - Unix timestamp string (seconds)
 * @param body      - Raw JSON body string
 * @param secret    - WEBHOOK_SECRET
 */
export function computeWebhookSignature(
  timestamp: string,
  body: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

/**
 * Express middleware that verifies the AgentPay webhook signature.
 *
 * Attach to any route that receives inbound webhooks to prevent spoofing:
 *
 * ```ts
 * router.post('/incoming', verifyWebhookSignature, handler);
 * ```
 *
 * The raw body must be available as `req.rawBody` (Buffer) or the middleware
 * will fall back to `JSON.stringify(req.body)`.  To capture the raw body,
 * mount `express.raw({ type: 'application/json' })` before this middleware on
 * the target route, or use the `captureRawBody` helper exported below.
 */
export function verifyWebhookSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    logger.warn('[verifyWebhook] WEBHOOK_SECRET not set — skipping signature check');
    next();
    return;
  }

  const signature = req.headers['x-agentpay-signature'] as string | undefined;
  const timestamp = req.headers['x-agentpay-timestamp'] as string | undefined;

  if (!signature || !timestamp) {
    logger.warn('[verifyWebhook] Missing signature or timestamp headers', {
      hasSignature: !!signature,
      hasTimestamp: !!timestamp,
      path: req.path,
    });
    res.status(401).json({
      error: 'WEBHOOK_SIGNATURE_MISSING',
      message: 'x-agentpay-signature and x-agentpay-timestamp headers are required',
    });
    return;
  }

  // Validate timestamp is within the replay window
  const tsMs = Number(timestamp) * 1000;
  if (Number.isNaN(tsMs)) {
    res.status(401).json({
      error: 'WEBHOOK_TIMESTAMP_INVALID',
      message: 'x-agentpay-timestamp must be a Unix timestamp in seconds',
    });
    return;
  }

  const drift = Math.abs(Date.now() - tsMs);
  if (drift > REPLAY_WINDOW_MS) {
    logger.warn('[verifyWebhook] Timestamp outside replay window', { drift, path: req.path });
    res.status(401).json({
      error: 'WEBHOOK_REPLAY_DETECTED',
      message: `Timestamp is outside the ±5 minute replay window (drift: ${Math.round(drift / 1000)}s)`,
    });
    return;
  }

  // Use raw body if available (capture with captureRawBody middleware),
  // otherwise fall back to JSON.stringify of the parsed body.
  const rawBody: string =
    (req as any).rawBody instanceof Buffer
      ? (req as any).rawBody.toString('utf-8')
      : JSON.stringify(req.body ?? {});

  const expected = computeWebhookSignature(timestamp, rawBody, secret);

  let isValid: boolean;
  try {
    isValid = timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    isValid = false;
  }

  if (!isValid) {
    logger.warn('[verifyWebhook] Signature mismatch', { path: req.path });
    res.status(401).json({
      error: 'WEBHOOK_SIGNATURE_INVALID',
      message: 'Webhook signature does not match',
    });
    return;
  }

  logger.info('[verifyWebhook] Signature verified', { path: req.path });
  next();
}

/**
 * Express middleware that captures the raw request body into `req.rawBody`
 * before JSON parsing.  Mount this BEFORE `express.json()` on routes that
 * need webhook signature verification.
 *
 * ```ts
 * router.post('/incoming', captureRawBody, verifyWebhookSignature, handler);
 * ```
 */
export function captureRawBody(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    (req as any).rawBody = Buffer.concat(chunks);
    next();
  });
}
