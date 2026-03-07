import crypto from 'crypto';
import axios from 'axios';
import { query } from '../db/index.js';
import { logger } from '../logger.js';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'change-me-in-production';
const WEBHOOK_TIMEOUT_MS = 5000;
const RETRY_DELAYS_MS = [0, 5000, 25000]; // 3 attempts: immediate, 5s, 25s

// Private IPv4/IPv6 ranges that must not be reachable via webhook URLs (SSRF protection)
const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  // IPv6 — URL.hostname strips brackets on some runtimes, so match both forms
  /^\[?::1\]?$/,
  /^\[?fc00:/i,
  /^\[?fd[0-9a-f]{2}:/i,
  /^169\.254\./,    // link-local
  /^0\./,           // 0.0.0.0/8
];

/**
 * Validates a webhook URL is a safe, public HTTPS endpoint.
 * Rejects private/loopback addresses to prevent SSRF attacks.
 */
export function validateWebhookUrl(url: string): { valid: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'URL is not valid' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Webhook URL must use HTTPS' };
  }

  const hostname = parsed.hostname.toLowerCase();
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return { valid: false, reason: 'Webhook URL must not point to a private or loopback address' };
    }
  }

  return { valid: true };
}

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
 * Delivers a webhook with automatic retry (exponential backoff).
 *
 * Design: this function runs its retry loop asynchronously (each delay uses
 * setTimeout, yielding the event loop between retries). Callers should invoke
 * it WITHOUT `await` to keep it truly fire-and-forget:
 *   webhooksService.scheduleWebhook(...).catch(() => {});
 *
 * Note for production scale: for very high volumes, consider replacing this
 * with a proper job queue (e.g. BullMQ / pg-boss) so retries survive restarts
 * and cluster workers don't duplicate deliveries.
 */
export async function scheduleWebhook(
  webhookUrl: string,
  payload: WebhookPayload,
  merchantId: string,
  transactionId: string | null = null
): Promise<void> {
  // SSRF protection — reject private/non-HTTPS URLs before touching the network
  const urlCheck = validateWebhookUrl(webhookUrl);
  if (!urlCheck.valid) {
    logger.warn('Webhook delivery blocked: invalid URL', { webhookUrl, reason: urlCheck.reason, merchantId });
    return;
  }

  const payloadStr = JSON.stringify(payload);
  const signature = signPayload(payloadStr);
  const eventId = await createWebhookEvent(
    merchantId,
    transactionId,
    payload.event,
    webhookUrl,
    payload
  );

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
