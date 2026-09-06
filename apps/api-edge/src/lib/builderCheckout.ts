/**
 * Builder plan Stripe Checkout — $39/mo price_1U9CNjPXcf9g8qGxzygstusB
 *
 * Collection is available only when STRIPE_SECRET_KEY is present.
 * This module never invents a buy.stripe.com Payment Link.
 */

export const BUILDER_STRIPE_PRICE_ID = 'price_1U9CNjPXcf9g8qGxzygstusB';
export const BUILDER_MONTHLY_USD = 39;

export type BuilderCollection = {
  method: 'stripe_checkout';
  available: boolean;
  priceId: string;
  monthlyUsd: number;
  requiredEnv: string[];
};

export function builderCollectionStatus(stripeSecretKey?: string | null): BuilderCollection {
  return {
    method: 'stripe_checkout',
    available: Boolean(stripeSecretKey),
    priceId: BUILDER_STRIPE_PRICE_ID,
    monthlyUsd: BUILDER_MONTHLY_USD,
    requiredEnv: stripeSecretKey ? [] : ['STRIPE_SECRET_KEY'],
  };
}

export function builderCheckoutUnavailableBody(stripeSecretKey?: string | null) {
  const collection = builderCollectionStatus(stripeSecretKey);
  return {
    error: 'BUILDER_CHECKOUT_NOT_CONFIGURED',
    message:
      'Builder $39 checkout needs STRIPE_SECRET_KEY on api-edge. Price price_1U9CNjPXcf9g8qGxzygstusB already exists. Do not publish a guessed buy.stripe.com link.',
    collection,
    requiredEnv: collection.requiredEnv,
  };
}
