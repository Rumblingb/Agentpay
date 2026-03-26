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
