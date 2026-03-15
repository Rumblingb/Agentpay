import prisma from '../lib/prisma.js';
import * as webhooksService from './webhooks.js';
import { logger } from '../logger.js';

export interface WhereClause {
  [key: string]: any;
}

export async function scheduleWebhookWithRollback(
  webhookUrl: string,
  payload: unknown,
  merchantId: string,
  where: WhereClause,
  options: { awaitDelivery?: boolean } = { awaitDelivery: false },
) {
  try {
    const updated = await prisma.transactions.updateMany({
      where: where,
      data: { webhook_status: 'scheduled' },
    });

    if (!(updated as any).count || (updated as any).count === 0) {
      logger.debug('WebhookScheduler: webhook already scheduled (no-op)', { where });
      return;
    }

    const delivery = webhooksService.scheduleWebhook(webhookUrl, payload as any, merchantId, (where.id ?? where.payment_id) as string);

    if (options.awaitDelivery) {
      try {
        await delivery;
      } catch (err) {
        logger.error('WebhookScheduler: delivery failed, attempting rollback', { err });
        try {
          await prisma.transactions.updateMany({
            where: { ...where, webhook_status: 'scheduled' },
            data: { webhook_status: 'not_sent' },
          });
        } catch (rbErr) {
          logger.error('WebhookScheduler: rollback failed', { rbErr });
        }
      }
    } else {
      delivery.catch(async (err) => {
        logger.error('WebhookScheduler: delivery failed (async), attempting rollback', { err });
        try {
          await prisma.transactions.updateMany({
            where: { ...where, webhook_status: 'scheduled' },
            data: { webhook_status: 'not_sent' },
          });
        } catch (rbErr) {
          logger.error('WebhookScheduler: rollback failed (async)', { rbErr });
        }
      });
    }
  } catch (err) {
    logger.error('WebhookScheduler: failed to mark webhook_status', { err, where });
  }
}

export default { scheduleWebhookWithRollback };
