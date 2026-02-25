import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/index';
import { logger } from '../logger';

export interface WebhookSubscription {
  id: string;
  merchantId: string;
  url: string;
  eventTypes: string[];
  createdAt: Date;
}

export interface WebhookDeliveryLog {
  id: string;
  subscriptionId: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  lastAttemptAt: Date | null;
  createdAt: Date;
}

export async function createSubscription(
  merchantId: string,
  url: string,
  eventTypes: string[]
): Promise<WebhookSubscription> {
  const id = uuidv4();
  const result = await query(
    `INSERT INTO webhook_subscriptions (id, merchant_id, url, event_types, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING id, merchant_id as "merchantId", url, event_types as "eventTypes", created_at as "createdAt"`,
    [id, merchantId, url, eventTypes]
  );
  return result.rows[0] as WebhookSubscription;
}

export async function listSubscriptions(merchantId: string): Promise<WebhookSubscription[]> {
  const result = await query(
    `SELECT id, merchant_id as "merchantId", url, event_types as "eventTypes", created_at as "createdAt"
     FROM webhook_subscriptions
     WHERE merchant_id = $1
     ORDER BY created_at DESC`,
    [merchantId]
  );
  return result.rows as WebhookSubscription[];
}

export async function deleteSubscription(id: string, merchantId: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM webhook_subscriptions WHERE id = $1 AND merchant_id = $2`,
    [id, merchantId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getSubscriptionsForEvent(
  merchantId: string,
  eventType: string
): Promise<WebhookSubscription[]> {
  const result = await query(
    `SELECT id, merchant_id as "merchantId", url, event_types as "eventTypes", created_at as "createdAt"
     FROM webhook_subscriptions
     WHERE merchant_id = $1 AND $2 = ANY(event_types)`,
    [merchantId, eventType]
  );
  return result.rows as WebhookSubscription[];
}

export async function createDeliveryLog(
  subscriptionId: string,
  payload: Record<string, unknown>
): Promise<WebhookDeliveryLog> {
  const id = uuidv4();
  const result = await query(
    `INSERT INTO webhook_delivery_logs (id, subscription_id, payload, status, attempts, created_at)
     VALUES ($1, $2, $3, 'pending', 0, NOW())
     RETURNING id, subscription_id as "subscriptionId", payload, status, attempts,
               last_attempt_at as "lastAttemptAt", created_at as "createdAt"`,
    [id, subscriptionId, JSON.stringify(payload)]
  );
  return result.rows[0] as WebhookDeliveryLog;
}

export async function getPendingDeliveryLogs(limit = 50): Promise<
  Array<WebhookDeliveryLog & { subscriptionUrl: string }>
> {
  const result = await query(
    `SELECT dl.id, dl.subscription_id as "subscriptionId", dl.payload, dl.status,
            dl.attempts, dl.last_attempt_at as "lastAttemptAt", dl.created_at as "createdAt",
            ws.url as "subscriptionUrl"
     FROM webhook_delivery_logs dl
     JOIN webhook_subscriptions ws ON ws.id = dl.subscription_id
     WHERE dl.status = 'pending'
     ORDER BY dl.created_at ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows as Array<WebhookDeliveryLog & { subscriptionUrl: string }>;
}

export async function updateDeliveryLog(
  id: string,
  status: 'pending' | 'sent' | 'failed',
  attempts: number
): Promise<void> {
  try {
    await query(
      `UPDATE webhook_delivery_logs
       SET status = $1, attempts = $2, last_attempt_at = NOW()
       WHERE id = $3`,
      [status, attempts, id]
    );
  } catch (err) {
    logger.error('Failed to update delivery log', { err, id });
  }
}

export default {
  createSubscription,
  listSubscriptions,
  deleteSubscription,
  getSubscriptionsForEvent,
  createDeliveryLog,
  getPendingDeliveryLogs,
  updateDeliveryLog,
};
