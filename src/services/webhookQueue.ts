/**
 * BullMQ-based webhook delivery queue.
 *
 * Replaces the in-process setTimeout retry loop with a persistent Redis-backed
 * queue that survives server restarts and prevents duplicate deliveries.
 *
 * Retry schedule (exponential backoff):
 *   Attempt 1 → immediate
 *   Attempt 2 → 1 minute
 *   Attempt 3 → 5 minutes
 *   Attempt 4 → 15 minutes
 *   Attempt 5 → 1 hour
 *   Attempt 6 → 6 hours
 *   (Dead Letter Queue after 6 failures)
 */

import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import axios from 'axios';
import { signPayload, WebhookPayload } from './webhooks';
import { query } from '../db/index';
import { logger } from '../logger';

// ── Redis Connection ───────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let connection: IORedis | undefined;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

// ── Queue Definition ───────────────────────────────────────────────────────

const QUEUE_NAME = 'agentpay-webhooks';

let webhookQueue: Queue | undefined;

export function getWebhookQueue(): Queue {
  if (!webhookQueue) {
    webhookQueue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 6,
        backoff: {
          type: 'custom',
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return webhookQueue;
}

// ── Custom Backoff Strategy ────────────────────────────────────────────────

/** Exponential backoff delays in ms: 1m, 5m, 15m, 1h, 6h */
const BACKOFF_DELAYS_MS = [
  60_000,        // 1 minute
  300_000,       // 5 minutes
  900_000,       // 15 minutes
  3_600_000,     // 1 hour
  21_600_000,    // 6 hours
];

function calculateBackoff(attemptsMade: number): number {
  const index = Math.min(attemptsMade - 1, BACKOFF_DELAYS_MS.length - 1);
  return BACKOFF_DELAYS_MS[index];
}

// ── Job Data Interface ─────────────────────────────────────────────────────

export interface WebhookJobData {
  webhookUrl: string;
  payload: WebhookPayload;
  merchantId: string;
  transactionId: string | null;
  eventId: string | null;
}

// ── Enqueue Function ───────────────────────────────────────────────────────

/**
 * Adds a webhook delivery job to the queue.
 * Uses transactionId as the job key for idempotency — duplicate events for the
 * same transaction are silently deduplicated by BullMQ.
 */
export async function enqueueWebhook(
  webhookUrl: string,
  payload: WebhookPayload,
  merchantId: string,
  transactionId: string | null = null,
  eventId: string | null = null,
): Promise<string | undefined> {
  const queue = getWebhookQueue();

  const jobData: WebhookJobData = {
    webhookUrl,
    payload,
    merchantId,
    transactionId,
    eventId,
  };

  // Use transactionId + event type as the idempotency key
  const jobId = transactionId
    ? `${transactionId}:${payload.event}`
    : undefined;

  const job = await queue.add('deliver', jobData, {
    jobId,
    backoff: { type: 'custom' },
  });

  logger.info('Webhook job enqueued', {
    jobId: job.id,
    event: payload.event,
    merchantId,
    transactionId,
  });

  return job.id;
}

// ── Worker ─────────────────────────────────────────────────────────────────

const WEBHOOK_TIMEOUT_MS = 5000;

let webhookWorker: Worker | undefined;

/**
 * Starts the BullMQ worker that processes webhook delivery jobs.
 * Should be called once on server start-up.
 */
export function startWebhookWorker(): Worker {
  if (webhookWorker) return webhookWorker;

  webhookWorker = new Worker(
    QUEUE_NAME,
    async (job: Job<WebhookJobData>) => {
      const { webhookUrl, payload, eventId } = job.data;
      const payloadStr = JSON.stringify(payload);
      const signature = signPayload(payloadStr);

      const response = await axios.post(webhookUrl, payload, {
        timeout: WEBHOOK_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'X-AgentPay-Signature': signature,
          'User-Agent': 'AgentPay-Webhook/1.0',
        },
        validateStatus: () => true,
      });

      const succeeded = response.status >= 200 && response.status < 300;

      // Update DB record
      if (eventId) {
        try {
          await query(
            `UPDATE webhook_events
             SET status = $1, retry_count = $2, response_status = $3,
                 response_body = $4, last_attempt_at = NOW()
             WHERE id = $5`,
            [
              succeeded ? 'sent' : 'retrying',
              job.attemptsMade,
              response.status,
              String(response.data ?? '').substring(0, 500),
              eventId,
            ],
          );
        } catch (dbErr) {
          logger.error('Failed to update webhook event', { err: dbErr });
        }
      }

      if (!succeeded) {
        throw new Error(
          `Webhook delivery returned ${response.status} (attempt ${job.attemptsMade})`,
        );
      }

      logger.info('Webhook delivered successfully', {
        webhookUrl,
        attempt: job.attemptsMade,
        status: response.status,
        event: payload.event,
      });
    },
    {
      connection: getRedisConnection(),
      settings: {
        backoffStrategy: calculateBackoff,
      },
    },
  );

  // ── Dead Letter Queue logging ──────────────────────────────────────────

  webhookWorker.on('failed', async (job, err) => {
    if (!job) return;
    const isFinal = job.attemptsMade >= (job.opts?.attempts ?? 6);

    if (isFinal) {
      logger.error('🔴 Webhook moved to Dead Letter Queue', {
        jobId: job.id,
        event: job.data.payload.event,
        merchantId: job.data.merchantId,
        transactionId: job.data.transactionId,
        webhookUrl: job.data.webhookUrl,
        attempts: job.attemptsMade,
        lastError: err.message,
      });

      // Mark as failed in DB
      if (job.data.eventId) {
        try {
          await query(
            `UPDATE webhook_events SET status = 'failed', retry_count = $1, last_attempt_at = NOW() WHERE id = $2`,
            [job.attemptsMade, job.data.eventId],
          );
        } catch (dbErr) {
          logger.error('Failed to mark webhook as dead-lettered', { err: dbErr });
        }
      }
    } else {
      logger.warn('Webhook delivery attempt failed, will retry', {
        jobId: job.id,
        attempt: job.attemptsMade,
        error: err.message,
      });
    }
  });

  webhookWorker.on('error', (err) => {
    logger.error('Webhook worker error', { err });
  });

  logger.info('🚀 Webhook worker started');
  return webhookWorker;
}

// ── Graceful Shutdown ──────────────────────────────────────────────────────

export async function shutdownWebhookQueue(): Promise<void> {
  if (webhookWorker) {
    await webhookWorker.close();
    webhookWorker = undefined;
  }
  if (webhookQueue) {
    await webhookQueue.close();
    webhookQueue = undefined;
  }
  if (connection) {
    connection.disconnect();
    connection = undefined;
  }
}
