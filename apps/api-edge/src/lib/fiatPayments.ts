import type { Env } from '../types';
import {
  createUpiPaymentLink,
  type CreateUpiPaymentLinkParams,
  type UpiPaymentLinkResult,
} from './razorpay';
import { AirwallexClient, formatAirwallexStatus } from './airwallex';

export type FiatProvider = 'razorpay' | 'airwallex' | 'stripe';
export type FiatRail = 'upi_link' | 'upi_intent' | 'card';

export type FiatProviderCapabilities = {
  provider: FiatProvider;
  rails: FiatRail[];
};

export type HostedUpiPaymentResult = UpiPaymentLinkResult & {
  provider: 'razorpay';
};

export type HostedCardCheckoutResult = {
  provider: 'stripe';
  checkoutSessionId: string;
  checkoutUrl: string;
  customerId: string | null;
  expiresAt: string | null;
};

export type DirectPaymentIntentResult = {
  provider: 'airwallex';
  id: string;
  clientSecret: string;
  status: 'pending' | 'succeeded' | 'failed';
  rawStatus: string;
};

export function getConfiguredFiatProviders(env: Env): FiatProviderCapabilities[] {
  const providers: FiatProviderCapabilities[] = [];

  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) {
    providers.push({ provider: 'razorpay', rails: ['upi_link'] });
  }

  if (env.AIRWALLEX_CLIENT_ID && env.AIRWALLEX_API_KEY) {
    providers.push({ provider: 'airwallex', rails: ['upi_intent', 'card'] });
  }

  if (env.STRIPE_SECRET_KEY) {
    providers.push({ provider: 'stripe', rails: ['card'] });
  }

  return providers;
}

export function selectFiatProvider(env: Env, rail: FiatRail): FiatProvider | null {
  const match = getConfiguredFiatProviders(env).find((provider) => provider.rails.includes(rail));
  return match?.provider ?? null;
}

export async function createHostedUpiPayment(
  env: Env,
  params: CreateUpiPaymentLinkParams,
): Promise<HostedUpiPaymentResult | null> {
  const provider = selectFiatProvider(env, 'upi_link');
  if (provider !== 'razorpay') return null;

  try {
    const result = await createUpiPaymentLink(env, params);
    return {
      provider: 'razorpay',
      ...result,
    };
  } catch {
    return null;
  }
}

export async function createDirectPaymentIntent(
  env: Env,
  params: {
    amount: number;
    currency: 'INR' | 'GBP' | 'USD' | 'EUR';
    descriptor: string;
    orderId: string;
    returnUrl: string;
  },
): Promise<DirectPaymentIntentResult | null> {
  const provider = selectFiatProvider(env, 'upi_intent');
  if (provider !== 'airwallex' || !env.AIRWALLEX_CLIENT_ID || !env.AIRWALLEX_API_KEY) {
    return null;
  }

  const client = new AirwallexClient(
    env.AIRWALLEX_CLIENT_ID,
    env.AIRWALLEX_API_KEY,
    env.AIRWALLEX_SANDBOX === 'true',
  );
  const result = await client.createPaymentIntent(params);
  if (!result) return null;

  return {
    provider: 'airwallex',
    id: result.id,
    clientSecret: result.clientSecret,
    rawStatus: result.status,
    status: formatAirwallexStatus(result.status),
  };
}

export async function createHostedCardCheckout(
  env: Env,
  params: {
    amount: number;
    currency: string;
    description: string;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
    customerId?: string;
    principalId?: string;
    metadata?: Record<string, string>;
  },
): Promise<HostedCardCheckoutResult | null> {
  if (!env.STRIPE_SECRET_KEY) return null;

  const currency = params.currency.trim().toLowerCase();
  const amountSmallestUnit = Math.max(Math.round(params.amount * 100), 50);
  const checkoutBody = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price_data][currency]': currency,
    'line_items[0][price_data][product_data][name]': params.description,
    'line_items[0][price_data][unit_amount]': String(amountSmallestUnit),
    'line_items[0][quantity]': '1',
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    // Save card after first payment — enables frictionless future bookings
    'payment_method_options[card][setup_future_usage]': 'off_session',
    ...(!params.customerId && params.customerEmail ? { customer_email: params.customerEmail } : {}),
    ...(params.customerId ? { customer: params.customerId } : {}),
  });

  for (const [key, value] of Object.entries(params.metadata ?? {})) {
    checkoutBody.set(`metadata[${key}]`, value);
  }
  // Always include principalId in Stripe metadata so the webhook can save the card
  if (params.principalId) {
    checkoutBody.set('metadata[principalId]', params.principalId);
  }

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: checkoutBody.toString(),
  });

  if (!stripeRes.ok) {
    const details = await stripeRes.text().catch(() => '');
    throw new Error(`STRIPE_CHECKOUT_CREATE_FAILED:${details}`);
  }

  const session = await stripeRes.json() as {
    id: string;
    url: string;
    customer?: string | null;
    expires_at?: number | null;
  };

  return {
    provider: 'stripe',
    checkoutSessionId: session.id,
    checkoutUrl: session.url,
    customerId: session.customer ?? null,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
  };
}
