import Stripe from 'stripe';
import { query } from '../db/index';
import { logger } from '../logger';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2026-01-28.clover',
});

/**
 * Creates a Stripe Connect account and returns an onboarding URL.
 * Persists the connected account ID on the merchant row.
 */
export async function createConnectOnboardingLink(
  merchantId: string,
  merchantEmail: string,
  returnUrl: string,
  refreshUrl: string
): Promise<{ url: string; accountId: string }> {
  // Create a Connect Express account for the merchant
  const account = await stripe.accounts.create({
    type: 'express',
    email: merchantEmail,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });

  // Persist the stripe_connected_account_id on the merchant record
  await query(
    `UPDATE merchants SET stripe_connected_account_id = $1, updated_at = NOW() WHERE id = $2`,
    [account.id, merchantId]
  );

  logger.info('Stripe Connect account created', { merchantId, stripeAccountId: account.id });

  const accountLink = await stripe.accountLinks.create({
    account: account.id,
    return_url: returnUrl,
    refresh_url: refreshUrl,
    type: 'account_onboarding',
  });

  return { url: accountLink.url, accountId: account.id };
}

/**
 * Creates a Stripe Checkout Session for a fiat (USD) payment routed to the
 * merchant's connected account. Returns a Checkout Session URL and session ID.
 */
export async function createFiatIntent(
  merchantId: string,
  amountUsd: number,
  currency: string = 'usd',
  description: string = 'AgentPay Payment'
): Promise<{ intentId: string; sessionId: string; sessionUrl: string }> {
  // Look up the merchant's connected account
  const result = await query(
    `SELECT stripe_connected_account_id FROM merchants WHERE id = $1`,
    [merchantId]
  );

  const connectedAccountId: string | null =
    result.rows[0]?.stripe_connected_account_id ?? null;

  if (!connectedAccountId) {
    throw new Error('Merchant has not completed Stripe Connect onboarding');
  }

  // Convert dollar amount to cents
  const amountCents = Math.round(amountUsd * 100);

  // Create a PaymentIntent on the connected account (non-custodial)
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency,
      description,
      metadata: { merchantId },
    },
    { stripeAccount: connectedAccountId }
  );

  // Create a Checkout Session that uses the PaymentIntent and pays the merchant directly
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      payment_intent_data: {
        on_behalf_of: connectedAccountId,
        transfer_data: { destination: connectedAccountId },
      },
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: amountCents,
            product_data: { name: description },
          },
          quantity: 1,
        },
      ],
      success_url:
        process.env.STRIPE_SUCCESS_URL || 'https://example.com/success',
      cancel_url:
        process.env.STRIPE_CANCEL_URL || 'https://example.com/cancel',
      metadata: { merchantId, paymentIntentId: paymentIntent.id },
    }
  );

  const intentId = paymentIntent.id;
  const sessionId = session.id;

  // Store stripe_payment_reference (sessionId) on the transaction row if one exists,
  // but the primary record here is returned to the caller to link as needed.
  logger.info('Fiat intent created', { merchantId, intentId, sessionId });

  return { intentId, sessionId, sessionUrl: session.url! };
}

/**
 * Validates a Stripe webhook signature and returns the parsed event.
 * Throws if the signature is invalid.
 */
export function constructStripeEvent(
  rawBody: Buffer | string,
  signature: string,
  webhookSecret: string
): Stripe.Event {
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

/**
 * Retrieves the stripe_payment_reference (Checkout sessionId) linked to a
 * transaction so the webhook handler can find the right intent row.
 */
export async function getIntentByStripeReference(
  stripeReference: string
): Promise<{ id: string; merchantId: string } | null> {
  const result = await query(
    `SELECT id, merchant_id as "merchantId" FROM transactions WHERE stripe_payment_reference = $1`,
    [stripeReference]
  );
  return result.rows[0] ?? null;
}

/**
 * Marks a transaction as confirmed and records the stripe_payment_reference.
 */
export async function markIntentVerified(
  transactionId: string,
  stripeReference: string
): Promise<void> {
  await query(
    `UPDATE transactions
     SET status = 'confirmed', stripe_payment_reference = $1, updated_at = NOW()
     WHERE id = $2`,
    [stripeReference, transactionId]
  );
  logger.info('Intent marked verified via Stripe', { transactionId, stripeReference });
}

export default {
  createConnectOnboardingLink,
  createFiatIntent,
  constructStripeEvent,
  getIntentByStripeReference,
  markIntentVerified,
};
