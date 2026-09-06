jest.mock('../../apps/api-edge/src/lib/db', () => {
  const actual = jest.requireActual('../../apps/api-edge/src/lib/db');
  return {
    ...actual,
    createDb: jest.fn(),
  };
});

import { createDb } from '../../apps/api-edge/src/lib/db';
import apiEdge from '../../apps/api-edge/src/index';

function appEnv(extra: Record<string, unknown> = {}) {
  return {
    DATABASE_URL: 'postgres://agentpay:test@localhost:5432/agentpay',
    WEBHOOK_SECRET: 'w'.repeat(32),
    AGENTPAY_SIGNING_SECRET: 's'.repeat(32),
    VERIFICATION_SECRET: 'v'.repeat(32),
    ADMIN_SECRET_KEY: 'a'.repeat(32),
    CORS_ORIGIN: 'http://localhost:3000',
    API_BASE_URL: 'http://agentpay.test',
    FRONTEND_URL: 'https://agentpay.so',
    AGENTPAY_TEST_MODE: 'true',
    NODE_ENV: 'development',
    ...extra,
  } as never;
}

describe('Builder $39 checkout collection', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (createDb as jest.Mock).mockReset();
  });

  it('documents the exact secret when Stripe is missing', async () => {
    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/billing/plans/builder', { method: 'POST' }),
      appEnv(),
      {} as never,
    );
    const body = await res.json() as {
      error: string;
      collection: { available: boolean; requiredEnv: string[] };
    };
    expect(res.status).toBe(503);
    expect(body.error).toBe('BUILDER_CHECKOUT_NOT_CONFIGURED');
    expect(body.collection.available).toBe(false);
    expect(body.collection.requiredEnv).toEqual(['STRIPE_SECRET_KEY']);
  });

  it('marks collection available and returns a checkout URL when Stripe is configured', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        id: 'cs_test_builder',
        url: 'https://checkout.stripe.com/c/pay/cs_test_builder',
      }),
    } as any);

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/billing/plans/builder', { method: 'POST' }),
      appEnv({ STRIPE_SECRET_KEY: 'sk_test_builder' }),
      {} as never,
    );
    const body = await res.json() as {
      checkoutUrl: string;
      collection: { available: boolean };
    };
    expect(res.status).toBe(201);
    expect(body.collection.available).toBe(true);
    expect(body.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_builder');
    const stripeBody = fetchSpy.mock.calls[0][1]?.body as string;
    expect(stripeBody).toContain('price_1U9CNjPXcf9g8qGxzygstusB');
    expect(stripeBody).toContain('billing_address_collection=auto');
    expect(stripeBody).toContain('payment_method_collection=always');
  });
});
