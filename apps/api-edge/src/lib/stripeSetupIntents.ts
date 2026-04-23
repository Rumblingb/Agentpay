import Stripe from 'stripe';
import type { Env } from '../types';

export function createStripeClient(env: Env): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }

  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export function stripeCustomerIdFromRef(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

export function stripePaymentMethodIdFromRef(
  paymentMethod: string | Stripe.PaymentMethod | null | undefined,
): string | null {
  if (!paymentMethod) return null;
  return typeof paymentMethod === 'string' ? paymentMethod : paymentMethod.id;
}

export async function verifySucceededSetupIntent(
  stripe: Stripe,
  setupIntentId: string,
  expectedPaymentMethodId?: string | null,
): Promise<{
  setupIntent: Stripe.SetupIntent;
  customerId: string;
  paymentMethodId: string;
}> {
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);

  if (setupIntent.status !== 'succeeded') {
    throw new Error('SETUP_INTENT_NOT_SUCCEEDED');
  }

  const customerId = stripeCustomerIdFromRef(setupIntent.customer);
  if (!customerId) {
    throw new Error('SETUP_INTENT_MISSING_CUSTOMER');
  }

  const paymentMethodId = stripePaymentMethodIdFromRef(setupIntent.payment_method);
  if (!paymentMethodId) {
    throw new Error('SETUP_INTENT_MISSING_PAYMENT_METHOD');
  }

  if (
    expectedPaymentMethodId &&
    expectedPaymentMethodId.trim() &&
    paymentMethodId !== expectedPaymentMethodId.trim()
  ) {
    throw new Error('SETUP_INTENT_PAYMENT_METHOD_MISMATCH');
  }

  return { setupIntent, customerId, paymentMethodId };
}
