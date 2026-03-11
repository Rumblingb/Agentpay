import { Router, Request, Response } from 'express';
import { authenticateApiKey } from '../middleware/auth.js';
import * as stripeService from '../services/stripeService.js';
import { logger } from '../logger.js';
import { env } from '../config/env.js';

const router = Router();

router.post('/connect', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const merchant = (req as any).merchant!;
    const baseUrl = env.API_BASE_URL;

    const defaultReturn = `${baseUrl}/api/stripe/onboard/return`;
    const defaultRefresh = `${baseUrl}/api/stripe/onboard/refresh`;

    // Validate URLs if provided — prevent open redirect
    let returnUrl = defaultReturn;
    let refreshUrl = defaultRefresh;

    if (req.body.returnUrl) {
      try {
        const parsed = new URL(req.body.returnUrl);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          returnUrl = req.body.returnUrl;
        }
      } catch {
        res.status(400).json({ error: 'Invalid returnUrl format' });
        return;
      }
    }

    if (req.body.refreshUrl) {
      try {
        const parsed = new URL(req.body.refreshUrl);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          refreshUrl = req.body.refreshUrl;
        }
      } catch {
        res.status(400).json({ error: 'Invalid refreshUrl format' });
        return;
      }
    }

    const { url, accountId } = await stripeService.createConnectOnboardingLink(
      merchant.id,
      merchant.email,
      returnUrl,
      refreshUrl
    );

    logger.info('Stripe Connect onboarding link created', { merchantId: merchant.id });

    res.status(200).json({
      success: true,
      onboardingUrl: url,
      stripeAccountId: accountId,
    });
  } catch (error: any) {
    logger.error('Stripe connect error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'stripe api error' });
  }
});

router.get('/account', authenticateApiKey, async (req: Request, res: Response) => {
  const merchant = (req as any).merchant!;
  res.json({ 
    connected: !!merchant.stripe_account_id,
    accountId: merchant.stripe_account_id || null 
  });
});
/**
 * GET /api/stripe/onboard/return
 * Stripe redirects here when onboarding is complete.
 */
router.get('/onboard/return', async (req: Request, res: Response) => {
  try {
    // Use URL parsing for safe redirect — only allow http(s) schemes
    const rawUrl = env.FRONTEND_URL;
    let dashboardUrl: string;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('Invalid protocol');
      }
      dashboardUrl = parsed.origin;
    } catch {
      dashboardUrl = 'http://localhost:3000';
    }
    
    res.redirect(`${dashboardUrl}/dashboard?stripe=success`);
  } catch (error) {
    res.status(500).send("Error returning from Stripe.");
  }
});

/**
 * GET /api/stripe/onboard/refresh
 * Stripe redirects here if the onboarding link expires or fails.
 */
router.get('/onboard/refresh', async (req: Request, res: Response) => {
  // Typically, you'd re-generate a link and redirect the user back to Stripe
  res.redirect('/dashboard/stripe-setup?error=link_expired');
});
export default router;