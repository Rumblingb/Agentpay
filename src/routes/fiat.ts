import { Router, Request, Response } from 'express';
import { authenticateApiKey } from '../middleware/auth';
import { logger } from '../logger';
import { getStripe } from '../services/stripeService';

const router = Router();

router.post('/onramp', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { amountUsd, successUrl, cancelUrl } = req.body;
    if (!amountUsd || typeof amountUsd !== 'number' || amountUsd <= 0) {
      res.status(400).json({ error: 'amountUsd must be a positive number' });
      return;
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(amountUsd * 100),
            product_data: { name: 'USDC On-Ramp' },
          },
          quantity: 1,
        },
      ],
      success_url: successUrl || process.env.STRIPE_SUCCESS_URL || 'https://example.com/success',
      cancel_url: cancelUrl || process.env.STRIPE_CANCEL_URL || 'https://example.com/cancel',
    });

    logger.info('Fiat on-ramp session created', { sessionId: session.id });
    res.status(201).json({ success: true, data: { sessionId: session.id, sessionUrl: session.url } });
  } catch (err: any) {
    logger.error('On-ramp error', { err });
    res.status(500).json({ error: 'Failed to create on-ramp session' });
  }
});

router.post('/offramp', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { connectedAccountId, amountUsd, currency = 'usd' } = req.body;
    if (!connectedAccountId || !amountUsd) {
      res.status(400).json({ error: 'connectedAccountId and amountUsd are required' });
      return;
    }

    const stripe = getStripe();
    const payout = await stripe.payouts.create(
      {
        amount: Math.round(amountUsd * 100),
        currency,
      },
      { stripeAccount: connectedAccountId }
    );

    logger.info('Fiat off-ramp payout created', { payoutId: payout.id });
    res.status(201).json({ success: true, data: { payoutId: payout.id, status: payout.status } });
  } catch (err: any) {
    logger.error('Off-ramp error', { err });
    res.status(500).json({ error: 'Failed to create off-ramp payout' });
  }
});

router.post('/issuing/create-card', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { connectedAccountId, cardholderId, spendingLimit } = req.body;
    if (!connectedAccountId || !cardholderId) {
      res.status(400).json({ error: 'connectedAccountId and cardholderId are required' });
      return;
    }

    const stripe = getStripe();
    const card = await stripe.issuing.cards.create(
      {
        cardholder: cardholderId,
        currency: 'usd',
        type: 'virtual',
        status: 'active',
        ...(spendingLimit
          ? {
              spending_controls: {
                spending_limits: [{ amount: Math.round(spendingLimit * 100), interval: 'monthly' }],
              },
            }
          : {}),
      },
      { stripeAccount: connectedAccountId }
    );

    logger.info('Issuing card created', { cardId: card.id });
    res.status(201).json({ success: true, data: { cardId: card.id, last4: card.last4, status: card.status } });
  } catch (err: any) {
    logger.error('Issuing card error', { err });
    res.status(500).json({ error: 'Failed to create issuing card' });
  }
});

export default router;
