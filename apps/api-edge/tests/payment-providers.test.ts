import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

import type { Env } from '../src/types';
import {
  createProviderPayment,
  decryptSensitivePaymentResponse,
  defaultPaymentPolicy,
  encryptSensitivePaymentResponse,
  enforcePaymentPolicy,
  fingerprintPaymentRequest,
  getPaymentProviderStatuses,
  minorToMajor,
  paymentReservationLockKeys,
  type PaymentPolicy,
  type PaymentRequest,
} from '../src/lib/paymentProviders';
import {
  classifyAirwallexProviderEvent,
  classifyStripeProviderEvent,
  verifyAirwallexProviderSignature,
} from '../src/routes/paymentProviderWebhooks';

const baseRequest: PaymentRequest = {
  provider: 'stripe',
  amountMinor: 1_250,
  currency: 'USD',
  merchantId: 'merchant_123',
  agentId: 'agent_123',
  idempotencyKey: 'idem_test_123',
  description: 'Agent tool purchase',
  successUrl: 'https://agentpay.so/payment/success',
  cancelUrl: 'https://agentpay.so/payment/cancel',
};

const allowPolicy: PaymentPolicy = {
  enabled: true,
  maxAmountMinor: 10_000,
  maxDailyAmountMinor: 50_000,
  allowedProviders: ['stripe', 'airwallex', 'x402'],
  allowedCurrencies: ['USD'],
  allowedAgents: [],
  allowedRedirectHosts: ['agentpay.so'],
  allowedRecipients: ['recipient_1'],
  allowedNetworks: ['eip155:8453'],
  allowedAssets: ['usdc_base'],
};

describe('governed payment providers', () => {
  it('enforces integer policy boundaries and fingerprints the complete request', async () => {
    expect(minorToMajor(1_001, 'USD')).toBe('10.01');
    expect(() => enforcePaymentPolicy(baseRequest, allowPolicy, { dailyAmountMinor: 49_000 }))
      .toThrow('Daily amount limit exceeded');
    expect(() => enforcePaymentPolicy(
      { ...baseRequest, successUrl: 'https://attacker.example/success' },
      allowPolicy,
      { dailyAmountMinor: 0 },
    )).toThrow('successUrl host is not allowlisted');

    const first = await fingerprintPaymentRequest({
      ...baseRequest,
      metadata: { z: 'last', a: 'first' },
    });
    const reordered = await fingerprintPaymentRequest({
      ...baseRequest,
      metadata: { a: 'first', z: 'last' },
    });
    const changed = await fingerprintPaymentRequest({ ...baseRequest, amountMinor: 1_251 });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);

    expect(paymentReservationLockKeys('merchant_123', 'idem_test_123', 'USD')).toEqual({
      idempotency: 'payment:idempotency:merchant_123:idem_test_123',
      dailyLimit: 'payment:daily-limit:merchant_123:USD',
    });

    const encryptionEnv = {
      AGENTPAY_PAYMENT_RESPONSE_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY',
    } as Env;
    const encrypted = await encryptSensitivePaymentResponse(encryptionEnv, {
      actionUrl: 'https://checkout.stripe.com/c/pay/test',
      clientSecret: 'secret_redacted',
    });
    expect(encrypted).not.toContain('secret_redacted');
    await expect(decryptSensitivePaymentResponse(encryptionEnv, encrypted)).resolves.toEqual({
      actionUrl: 'https://checkout.stripe.com/c/pay/test',
      clientSecret: 'secret_redacted',
    });
  });

  it('adapts enabled providers while keeping live, Visa, and x402 execution bounded', async () => {
    const stripeFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/test',
    }), { status: 200 }));
    const stripe = await createProviderPayment({
      STRIPE_SECRET_KEY: 'sk_test_redacted',
      STRIPE_PROVIDER_WEBHOOK_SECRET: 'whsec_redacted',
      AGENTPAY_PAYMENT_RESPONSE_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY',
      AGENTPAY_PAYMENT_MODE: 'sandbox',
    } as Env, baseRequest, allowPolicy, { dailyAmountMinor: 0 }, stripeFetch);
    expect(stripe).toMatchObject({ providerReference: 'cs_test_123', state: 'requires_action' });
    expect(((stripeFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>)['Idempotency-Key'])
      .toBe(baseRequest.idempotencyKey);

    const airwallexFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'token_redacted' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'int_awx_123',
        client_secret: 'secret_redacted',
        status: 'PENDING',
      }), { status: 200 }));
    const airwallex = await createProviderPayment({
      AIRWALLEX_CLIENT_ID: 'client_redacted',
      AIRWALLEX_API_KEY: 'key_redacted',
      AIRWALLEX_PROVIDER_WEBHOOK_SECRET: 'webhook_redacted',
      AGENTPAY_PAYMENT_RESPONSE_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY',
      AGENTPAY_PAYMENT_MODE: 'sandbox',
    } as Env, { ...baseRequest, provider: 'airwallex' }, allowPolicy, { dailyAmountMinor: 0 }, airwallexFetch);
    expect(airwallex).toMatchObject({ providerReference: 'int_awx_123', state: 'requires_action' });

    await expect(createProviderPayment(
      { AGENTPAY_PAYMENT_MODE: 'sandbox' } as Env,
      { ...baseRequest, provider: 'visa_cybersource' },
      { ...allowPolicy, allowedProviders: ['visa_cybersource'] },
      { dailyAmountMinor: 0 },
    )).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    await expect(createProviderPayment({
      STRIPE_SECRET_KEY: 'sk_live_redacted',
      STRIPE_PROVIDER_WEBHOOK_SECRET: 'whsec_redacted',
      AGENTPAY_PAYMENT_RESPONSE_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY',
      AGENTPAY_PAYMENT_MODE: 'live',
    } as Env, baseRequest, allowPolicy, { dailyAmountMinor: 0 }, vi.fn()))
      .rejects.toMatchObject({ code: 'LIVE_MODE_DISABLED' });

    expect(defaultPaymentPolicy({} as Env).enabled).toBe(false);
    expect(getPaymentProviderStatuses({} as Env).find((item) => item.provider === 'visa_cybersource'))
      .toMatchObject({ configured: false, liveEnabled: false });
    expect(getPaymentProviderStatuses({
      STRIPE_SECRET_KEY: 'sk_live_wrong_mode',
      STRIPE_PROVIDER_WEBHOOK_SECRET: 'whsec_redacted',
      AGENTPAY_ALLOWED_PAYMENT_REDIRECT_HOSTS: 'agentpay.so',
      AGENTPAY_PAYMENT_MODE: 'sandbox',
    } as Env).find((item) => item.provider === 'stripe')).toMatchObject({ configured: false });
  });

  it('accepts only signed, relevant provider webhook evidence', async () => {
    const timestamp = String(Date.now());
    const rawBody = '{"id":"evt_1"}';
    const secret = 'airwallex-test-secret';
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signatureBytes = new Uint8Array(await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}${rawBody}`),
    ));
    const signature = Array.from(signatureBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    await expect(verifyAirwallexProviderSignature(timestamp, rawBody, signature, secret))
      .resolves.toBe(true);
    await expect(verifyAirwallexProviderSignature(timestamp, `${rawBody}x`, signature, secret))
      .resolves.toBe(false);

    const stripeEvent = (type: string, paymentStatus = 'paid') => ({
      type,
      data: { object: { payment_status: paymentStatus } },
    }) as Stripe.Event;
    expect(classifyStripeProviderEvent(stripeEvent('checkout.session.completed'))).toBe('succeeded');
    expect(classifyStripeProviderEvent(stripeEvent('checkout.session.completed', 'unpaid'))).toBeNull();
    expect(classifyStripeProviderEvent(stripeEvent('checkout.session.expired'))).toBe('cancelled');
    expect(classifyAirwallexProviderEvent({
      name: 'payment_intent.status_changed',
      data: { object: { status: 'FAILED' } },
    })).toBe('failed');
  });
});
