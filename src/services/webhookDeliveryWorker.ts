import crypto from 'crypto';
import axios from 'axios';
import * as webhookController from '../controllers/webhookController';
import { logger } from '../logger';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'change-me-in-production';
const WEBHOOK_TIMEOUT_MS = 5000;

/** Retry delay schedule in milliseconds: 1s, 10s, 60s (3 total attempts). */
const RETRY_DELAYS_MS = [1000, 10000, 60000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

let workerTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Sign a payload string with HMAC-SHA256.
 * Sent as `X-AgentPay-Signature: sha256=<hex>`.
 */
export function signPayload(payload: string, secret: string = WEBHOOK_SECRET): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Deliver a single payload to a URL, returning true on HTTP 2xx success.
 */
async function deliver(
  url: string,
  payload: Record<string, unknown>,
  signature: string
): Promise<boolean> {
  const response = await axios.post(url, payload, {
    timeout: WEBHOOK_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      'X-AgentPay-Signature': signature,
      'User-Agent': 'AgentPay-Webhook/2.0',
    },
    validateStatus: () => true,
  });
  return response.status >= 200 && response.status < 300;
}

/**
 * Schedule delivery for a single delivery log entry.
 * Each retry waits RETRY_DELAYS_MS[attempt] before the next attempt.
 * Runs asynchronously; callers should NOT await this to keep it non-blocking.
 */
export async function scheduleDelivery(
  logId: string,
  url: string,
  payload: Record<string, unknown>
): Promise<void> {
  const payloadStr = JSON.stringify(payload);
  const signature = signPayload(payloadStr);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
    }

    try {
      const success = await deliver(url, payload, signature);
      const newAttempts = attempt + 1;

      if (success) {
        await webhookController.updateDeliveryLog(logId, 'sent', newAttempts);
        logger.info('Webhook delivered', { logId, url, attempt: newAttempts });
        return;
      }

      const isFinal = attempt === MAX_ATTEMPTS - 1;
      await webhookController.updateDeliveryLog(logId, isFinal ? 'failed' : 'pending', newAttempts);
      logger.warn('Webhook delivery non-2xx', { logId, url, attempt: newAttempts, isFinal });
    } catch (err: any) {
      const newAttempts = attempt + 1;
      const isFinal = attempt === MAX_ATTEMPTS - 1;
      await webhookController.updateDeliveryLog(logId, isFinal ? 'failed' : 'pending', newAttempts);
      logger.warn('Webhook delivery error', {
        logId,
        url,
        attempt: newAttempts,
        error: err?.message,
      });
    }
  }

  logger.error('Webhook delivery failed after all retries', { logId, url });
}

/**
 * Process a batch of pending deliveries.
 * Extension point: replace with BullMQ worker for production scale.
 */
export async function processPendingDeliveries(batchSize = 50): Promise<void> {
  try {
    const logs = await webhookController.getPendingDeliveryLogs(batchSize);
    for (const log of logs) {
      scheduleDelivery(log.id, log.subscriptionUrl, log.payload as Record<string, unknown>).catch(
        (err) => logger.error('Worker delivery error', { err, logId: log.id })
      );
    }
  } catch (err) {
    logger.error('processPendingDeliveries error', { err });
  }
}

/**
 * Start the background delivery worker loop.
 * Polls every `intervalMs` milliseconds for pending deliveries.
 */
export function startDeliveryWorker(intervalMs = 30000): void {
  if (workerTimer) return; // already running
  workerTimer = setInterval(() => {
    processPendingDeliveries().catch((err) =>
      logger.error('Delivery worker tick error', { err })
    );
  }, intervalMs);
  logger.info('Webhook delivery worker started', { intervalMs });
}

/**
 * Stop the background delivery worker.
 */
export function stopDeliveryWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    logger.info('Webhook delivery worker stopped');
  }
}

export default { scheduleDelivery, processPendingDeliveries, startDeliveryWorker, stopDeliveryWorker, signPayload };
