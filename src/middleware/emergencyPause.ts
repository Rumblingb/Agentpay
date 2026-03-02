/**
 * Emergency Pause Middleware
 *
 * Provides a "global kill switch" for merchants. When a merchant sets their
 * `emergency_pause` flag to true (e.g., detecting a bot attack), this
 * middleware blocks all payment intents for that merchant.
 *
 * Checks the `emergency_pause` column on the merchants table.
 */

import { Request, Response, NextFunction } from 'express';
import { query } from '../db/index';
import { logger } from '../logger';

interface AuthRequest extends Request {
  merchant?: {
    id: string;
  };
}

/**
 * Middleware that checks if the authenticated merchant has emergency_pause enabled.
 * If so, all requests are blocked with 503 Service Unavailable.
 *
 * Mount after authenticateApiKey on routes that handle payment intents.
 */
export async function checkEmergencyPause(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.merchant?.id) {
    return next();
  }

  try {
    const result = await query(
      `SELECT emergency_pause FROM merchants WHERE id = $1`,
      [req.merchant.id],
    );

    if (result.rows.length > 0 && result.rows[0].emergency_pause === true) {
      logger.warn('Emergency pause active — blocking request', {
        merchantId: req.merchant.id,
        path: req.path,
      });

      res.status(503).json({
        error: 'SERVICE_PAUSED',
        message: 'This merchant has activated emergency pause. All payment processing is temporarily suspended.',
      });
      return;
    }
  } catch (err: any) {
    // If the column doesn't exist, skip the check gracefully
    if (err?.message?.includes('column') && err?.message?.includes('does not exist')) {
      logger.debug('emergency_pause column not found, skipping check');
    } else {
      logger.error('Emergency pause check failed', { err: err.message });
    }
  }

  next();
}

export default { checkEmergencyPause };
