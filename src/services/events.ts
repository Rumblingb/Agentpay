/**
 * Platform event bus — emit structured events that fan-out to registered
 * webhook endpoints.
 *
 * Events emitted:
 *   agent.registered    escrow.opened       risk.flag
 *   job.created         escrow.settled      payment.failed
 *   job.completed       kyc.submitted
 *
 * Delivery is asynchronous with exponential-backoff retries.  Each attempt is
 * logged to the webhook_deliveries table (created in migration 025).
 *
 * HMAC signing: every delivery includes an `X-AgentPay-Signature` header
 * (HMAC-SHA256 of the JSON body keyed with WEBHOOK_SECRET) so platform
 * developers can verify authenticity.
 */

import crypto from 'crypto';
import { query } from '../db/index.js';
import { logger } from '../logger.js';
import { metrics } from './metrics.js';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'change-me-in-production';
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 2000; // 2s, 4s, 8s

// ---------------------------------------------------------------------------
// Event type catalogue
// ---------------------------------------------------------------------------
export type EventType =
  | 'agent.registered'
  | 'job.created'
  | 'job.completed'
  | 'escrow.opened'
  | 'escrow.settled'
  | 'risk.flag'
  | 'payment.failed'
  | 'kyc.submitted';

export interface AgentPayEvent {
  event: EventType;
  timestamp: string;
  payload: Record<string, unknown>;
  platformId?: string;
}

// ---------------------------------------------------------------------------
// HMAC signing helper
// ---------------------------------------------------------------------------
function signPayload(body: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

// ---------------------------------------------------------------------------
// Emit an event — resolves webhook subscribers and delivers asynchronously
// ---------------------------------------------------------------------------
export async function emitEvent(
  event: EventType,
  payload: Record<string, unknown>,
  platformId?: string,
): Promise<void> {
  const envelope: AgentPayEvent = {
    event,
    timestamp: new Date().toISOString(),
    payload,
    ...(platformId ? { platformId } : {}),
  };

  // Fan-out: deliver to all active webhook subscriptions for this platform
  // (or global subscriptions when platformId is undefined)
  let endpoints: { id: string; url: string }[] = [];

  try {
    const result = await query(
      `SELECT id, webhook_url
         FROM merchants
        WHERE webhook_url IS NOT NULL
          AND is_active = TRUE
          AND ($1::text IS NULL OR id = $1)
        LIMIT 100`,
      [platformId ?? null],
    );
    endpoints = result.rows.map((r: any) => ({ id: r.id, url: r.webhook_url }));
  } catch (err: any) {
    logger.warn({ err: err.message, event }, '[Events] Could not load webhook subscribers');
    return;
  }

  for (const endpoint of endpoints) {
    // Fire-and-forget with internal retries
    deliverWithRetry(endpoint.url, envelope, endpoint.id).catch((err) => {
      logger.error({ err: err.message, url: endpoint.url, event }, '[Events] Delivery failed after all retries');
    });
  }
}

// ---------------------------------------------------------------------------
// Deliver with exponential-backoff retries
// ---------------------------------------------------------------------------
async function deliverWithRetry(
  url: string,
  envelope: AgentPayEvent,
  merchantId: string,
): Promise<void> {
  const body = JSON.stringify(envelope);
  const signature = signPayload(body);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
    }

    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let success = false;

    try {
      const { default: fetch } = await import('node-fetch');
      const response = await (fetch as any)(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AgentPay-Signature': `sha256=${signature}`,
          'X-AgentPay-Event': envelope.event,
          'X-AgentPay-Timestamp': envelope.timestamp,
        },
        body,
        signal: AbortSignal.timeout(5000),
      });

      statusCode = response.status;
      responseBody = await response.text().catch(() => null);
      success = response.ok;
    } catch (err: any) {
      responseBody = err.message;
    }

    // Log delivery attempt
    try {
      await query(
        `INSERT INTO webhook_deliveries
           (merchant_id, event_type, url, payload, status_code, response_body, attempt, success)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          merchantId,
          envelope.event,
          url,
          body,
          statusCode,
          responseBody?.substring(0, 1000) ?? null,
          attempt + 1,
          success,
        ],
      );
    } catch {
      // Non-fatal: delivery logging failure must never break the main flow
    }

    metrics.increment('webhook_deliveries_total', {
      event: envelope.event,
      outcome: success ? 'success' : 'failed',
    });

    if (success) {
      logger.info({ url, event: envelope.event, attempt: attempt + 1 }, '[Events] Webhook delivered');
      return;
    }

    logger.warn(
      { url, event: envelope.event, attempt: attempt + 1, statusCode },
      '[Events] Webhook delivery attempt failed',
    );
  }

  throw new Error(`Webhook delivery to ${url} failed after ${MAX_RETRIES} attempts`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
