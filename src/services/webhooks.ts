import crypto from 'crypto';
import axios from 'axios';
import { query } from '../db/index';
import { logger } from '../logger';
import { enqueueWebhook } from './webhookQueue';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'change-me-in-production';
const WEBHOOK_TIMEOUT_MS = 5000;
const RETRY_DELAYS_MS = [0, 5000, 25000]; // 3 attempts: immediate, 5s, 25s

/** Whether to use BullMQ for webhook delivery (requires Redis). */
const USE_QUEUE = process.env.REDIS_URL ? true : false;

export interface WebhookPayload {
  event: string;
  transactionId: string;
  merchantId: string;
  paymentId?: string;
  amountUsdc?: number;
  recipientAddress?: string;
  payerAddress?: string;
  transactionHash?: string;
  verified: boolean;
  timestamp: string;
}

/**
 * Computes HMAC-SHA256 signature for the payload.
 * Sent as `X-AgentPay-Signature: sha256=<hex>` so merchants can verify authenticity.
 */
export function signPayload(payload: string, secret: string = WEBHOOK_SECRET): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Attempts a single HTTP POST to the webhook URL.
 */
async function attemptDelivery(
  webhookUrl: string,
  payload: WebhookPayload,
  signature: string
): Promise<{ status: number; body: string }> {
  const response = await axios.post(webhookUrl, payload, {
    timeout: WEBHOOK_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      'X-AgentPay-Signature': signature,
      'User-Agent': 'AgentPay-Webhook/1.0',
    },
    validateStatus: () => true, // don't throw on 4xx/5xx
  });
  return { status: response.status, body: String(response.data ?? '') };
}

/**
 * Persists a webhook event to the database and returns its ID.
 */
async function createWebhookEvent(
  merchantId: string,
  transactionId: string | null,
  eventType: string,
  webhookUrl: string,
  payload: WebhookPayload
): Promise<string | null> {
  try {
    const result = await query(
      `INSERT INTO webhook_events
         (merchant_id, event_type, transaction_id, webhook_url, payload, status, max_retries, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW())
       RETURNING id`,
      [merchantId, eventType, transactionId, webhookUrl, JSON.stringify(payload), RETRY_DELAYS_MS.length]
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    logger.error('Failed to persist webhook event', { err });
    return null;
  }
}

/**
 * Updates the webhook event record after an attempt.
 */
async function updateWebhookEvent(
  eventId: string,
  status: 'sent' | 'failed' | 'retrying',
  retryCount: number,
  responseStatus: number | null,
  responseBody: string | null
): Promise<void> {
  try {
    await query(
      `UPDATE webhook_events
       SET status = $1, retry_count = $2, response_status = $3, response_body = $4, last_attempt_at = NOW()
       WHERE id = $5`,
      [status, retryCount, responseStatus, responseBody, eventId]
    );
  } catch (err) {
    logger.error('Failed to update webhook event', { err });
  }
}

/**
 * Delivers a webhook with automatic retry.
 *
 * When REDIS_URL is set, jobs are enqueued to BullMQ for persistent,
 * crash-safe delivery with exponential backoff (5 retries: 1m → 6h).
 * Idempotency is enforced via transactionId as the BullMQ job key.
 *
 * When Redis is unavailable, falls back to the original in-process retry
 * loop (3 attempts: 0 s, 5 s, 25 s).
 */
export async function scheduleWebhook(
  webhookUrl: string,
  payload: WebhookPayload,
  merchantId: string,
  transactionId: string | null = null
): Promise<void> {
  const eventId = await createWebhookEvent(
    merchantId,
    transactionId,
    payload.event,
    webhookUrl,
    payload
  );

  // ── BullMQ path ────────────────────────────────────────────────────────
  if (USE_QUEUE) {
    try {
      await enqueueWebhook(webhookUrl, payload, merchantId, transactionId, eventId);
      return;
    } catch (err) {
      logger.warn('Failed to enqueue webhook to BullMQ, falling back to in-process delivery', { err });
    }
  }

  // ── In-process fallback ────────────────────────────────────────────────
  const payloadStr = JSON.stringify(payload);
  const signature = signPayload(payloadStr);

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt];

    await new Promise<void>((resolve) => setTimeout(resolve, delay));

    try {
      const { status, body } = await attemptDelivery(webhookUrl, payload, signature);
      const succeeded = status >= 200 && status < 300;

      if (eventId) {
        await updateWebhookEvent(
          eventId,
          succeeded ? 'sent' : attempt < RETRY_DELAYS_MS.length - 1 ? 'retrying' : 'failed',
          attempt + 1,
          status,
          body.substring(0, 500)
        );
      }

      if (succeeded) {
        logger.info('Webhook delivered successfully', {
          webhookUrl,
          attempt: attempt + 1,
          status,
          event: payload.event,
        });
        return;
      }

      logger.warn('Webhook delivery non-2xx, will retry', {
        webhookUrl,
        attempt: attempt + 1,
        status,
      });
    } catch (err: any) {
      const errMsg = err?.message ?? String(err);
      logger.warn('Webhook delivery attempt failed', {
        webhookUrl,
        attempt: attempt + 1,
        error: errMsg,
      });

      if (eventId) {
        await updateWebhookEvent(
          eventId,
          attempt < RETRY_DELAYS_MS.length - 1 ? 'retrying' : 'failed',
          attempt + 1,
          null,
          errMsg.substring(0, 500)
        );
      }
    }
  }

  logger.error('Webhook delivery failed after all retries', {
    webhookUrl,
    event: payload.event,
  });
}

export default { scheduleWebhook, signPayload };
