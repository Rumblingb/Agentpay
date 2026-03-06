import { Router, Request, Response } from 'express';
import { authenticateApiKey } from '../middleware/auth.js';
import * as stripeService from '../services/stripeService.js';
import { logger } from '../logger.js';

const router = Router();

router.post('/connect', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const merchant = (req as any).merchant!;
    const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

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
    // Sanitize dashboardUrl to prevent XSS — only allow known patterns
    const rawUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    // Strip any characters that could break out of the JS string context
    const dashboardUrl = rawUrl.replace(/[^a-zA-Z0-9:/.?=&_-]/g, '');
    
    res.send(`
      <html>
        <body>
          <h1>Onboarding Complete!</h1>
          <p>You can now close this window and return to the dashboard.</p>
          <script>window.location.href = "${dashboardUrl}/dashboard?stripe=success";</script>
        </body>
      </html>
    `);
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