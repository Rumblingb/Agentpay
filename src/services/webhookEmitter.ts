import * as webhookController from '../controllers/webhookController';
import { scheduleDelivery } from './webhookDeliveryWorker';
import { logger } from '../logger';

export interface PaymentVerifiedPayload {
  type: 'payment_verified';
  intentId: string;
  txHash: string;
  amount: number;
  certificate?: string;
}

/**
 * Emits a "payment_verified" event to all matching webhook subscriptions for a merchant.
 * Creates delivery log rows and schedules delivery in the background.
 * This function is fire-and-forget; it should be called without await.
 */
export async function emitPaymentVerified(
  merchantId: string,
  payload: PaymentVerifiedPayload
): Promise<void> {
  try {
    const subscriptions = await webhookController.getSubscriptionsForEvent(
      merchantId,
      'payment_verified'
    );

    if (subscriptions.length === 0) {
      return;
    }

    for (const sub of subscriptions) {
      try {
        const log = await webhookController.createDeliveryLog(
          sub.id,
          payload as unknown as Record<string, unknown>
        );
        setImmediate(() => {
          scheduleDelivery(log.id, sub.url, payload as unknown as Record<string, unknown>).catch(
            (err) => logger.error('Delivery scheduling error', { err, logId: log.id })
          );
        });
      } catch (err) {
        logger.error('Failed to create delivery log for subscription', { err, subscriptionId: sub.id });
      }
    }
  } catch (err) {
    logger.error('webhookEmitter.emitPaymentVerified failed', { err, merchantId });
  }
}

export default { emitPaymentVerified };
