import { Router, Request, Response } from 'express';
import { authenticateApiKey } from '../middleware/auth';
import * as stripeService from '../services/stripeService';
import { logger } from '../logger';

const router = Router();

/**
 * POST /api/stripe/onboard
 * Creates a Stripe Connect account link for the authenticated merchant and
 * returns the onboarding URL. Stores stripe_connected_account_id on merchant.
 */
router.post('/onboard', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const merchant = (req as any).merchant!;
    const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
    const returnUrl = req.body.returnUrl || `${baseUrl}/api/stripe/onboard/return`;
    const refreshUrl = req.body.refreshUrl || `${baseUrl}/api/stripe/onboard/refresh`;

    const { url, accountId } = await stripeService.createConnectOnboardingLink(
      merchant.id,
      merchant.email,
      returnUrl,
      refreshUrl
    );

    logger.info('Stripe onboarding link created', { merchantId: merchant.id, accountId });

    res.status(200).json({
      success: true,
      onboardingUrl: url,
      stripeAccountId: accountId,
    });
  } catch (error: any) {
    logger.error('Stripe onboard error', { error: error.message });
    res.status(500).json({ error: error.message || 'Failed to create onboarding link' });
  }
});

export default router;
