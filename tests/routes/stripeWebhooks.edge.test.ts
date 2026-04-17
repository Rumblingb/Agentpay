jest.mock('../../apps/api-edge/src/lib/db', () => ({
  createDb: jest.fn(),
}));

const mockConstructEventAsync = jest.fn();
jest.mock('stripe', () => ({
  __esModule: true,
  default: class Stripe {
    static createFetchHttpClient() {
      return {};
    }

    static createSubtleCryptoProvider() {
      return {};
    }

    webhooks = {
      constructEventAsync: mockConstructEventAsync,
    };
  },
}));

jest.mock('../../apps/api-edge/src/lib/mcpInvoices', () => ({
  markMerchantInvoicePaidByCheckoutSession: jest.fn(),
}));

jest.mock('../../apps/api-edge/src/lib/hostedActionSessions', () => ({
  syncHostedActionSession: jest.fn(),
}));

import { createDb } from '../../apps/api-edge/src/lib/db';
import { stripeWebhooksRouter } from '../../apps/api-edge/src/routes/stripeWebhooks';
import { markMerchantInvoicePaidByCheckoutSession } from '../../apps/api-edge/src/lib/mcpInvoices';
import { syncHostedActionSession } from '../../apps/api-edge/src/lib/hostedActionSessions';

function makeSql(responses: unknown[]) {
  const queue = [...responses];
  const sql = (jest.fn(async () => queue.shift()) as unknown) as jest.Mock & {
    end: jest.Mock;
  };
  sql.mockImplementation(async () => queue.shift());
  sql.end = jest.fn().mockResolvedValue(undefined);
  return sql;
}

function appEnv(extra: Record<string, unknown> = {}) {
  return {
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
    API_BASE_URL: 'http://agentpay.test',
    FRONTEND_URL: 'http://agentpay.test',
    AGENTPAY_SIGNING_SECRET: 's'.repeat(32),
    WEBHOOK_SECRET: 'w'.repeat(32),
    VERIFICATION_SECRET: 'v'.repeat(32),
    ADMIN_SECRET_KEY: 'a'.repeat(32),
    ...extra,
  } as never;
}

describe('stripeWebhooksRouter invoice settlement', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (createDb as jest.Mock).mockReset();
    (markMerchantInvoicePaidByCheckoutSession as jest.Mock).mockReset();
    (syncHostedActionSession as jest.Mock).mockReset();
    mockConstructEventAsync.mockReset();
  });

  it('settles hosted MCP and capability invoices when Stripe checkout completes', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([
      [{ event_id: 'evt_1' }],
      [],
    ]));
    mockConstructEventAsync.mockResolvedValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_billing_123',
          metadata: {},
        },
      },
    });
    (markMerchantInvoicePaidByCheckoutSession as jest.Mock).mockResolvedValue({
      invoiceId: 'inv_1',
      invoiceType: 'capability_usage',
      feeAmount: 12.5,
      currency: 'USD',
    });

    const waitUntilPromises: Promise<unknown>[] = [];
    const res = await stripeWebhooksRouter.fetch(
      new Request('http://agentpay.test/', {
        method: 'POST',
        headers: {
          'stripe-signature': 'sig_test',
        },
        body: JSON.stringify({ id: 'evt_1' }),
      }),
      appEnv(),
      {
        waitUntil(promise: Promise<unknown>) {
          waitUntilPromises.push(promise);
        },
        passThroughOnException() {},
      } as never,
    );

    expect(res.status).toBe(200);
    await Promise.all(waitUntilPromises);
    expect(markMerchantInvoicePaidByCheckoutSession).toHaveBeenCalledWith(
      expect.any(Object),
      'cs_billing_123',
    );
  });

  it('syncs hosted action sessions when Stripe checkout completes', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([
      [{ event_id: 'evt_2' }],
      [],
    ]));
    mockConstructEventAsync.mockResolvedValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_action_123',
          payment_status: 'paid',
          metadata: {
            actionSessionId: 'action_session_1',
          },
        },
      },
    });
    (markMerchantInvoicePaidByCheckoutSession as jest.Mock).mockResolvedValue(null);
    (syncHostedActionSession as jest.Mock).mockResolvedValue({
      sessionId: 'action_session_1',
      status: 'completed',
    });

    const waitUntilPromises: Promise<unknown>[] = [];
    const res = await stripeWebhooksRouter.fetch(
      new Request('http://agentpay.test/', {
        method: 'POST',
        headers: {
          'stripe-signature': 'sig_test',
        },
        body: JSON.stringify({ id: 'evt_2' }),
      }),
      appEnv(),
      {
        waitUntil(promise: Promise<unknown>) {
          waitUntilPromises.push(promise);
        },
        passThroughOnException() {},
      } as never,
    );

    expect(res.status).toBe(200);
    await Promise.all(waitUntilPromises);
    expect(syncHostedActionSession).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        sessionId: 'action_session_1',
        status: 'completed',
        resultPayload: expect.objectContaining({
          provider: 'stripe',
          stripeCheckoutSessionId: 'cs_action_123',
          stripePaymentStatus: 'paid',
        }),
      }),
    );
  });

  it('ignores duplicate Stripe webhook deliveries after the first write wins', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([
      [],
    ]));
    mockConstructEventAsync.mockResolvedValue({
      id: 'evt_dup_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_billing_123',
          metadata: {},
        },
      },
    });

    const waitUntilPromises: Promise<unknown>[] = [];
    const res = await stripeWebhooksRouter.fetch(
      new Request('http://agentpay.test/', {
        method: 'POST',
        headers: {
          'stripe-signature': 'sig_test',
        },
        body: JSON.stringify({ id: 'evt_dup_1' }),
      }),
      appEnv(),
      {
        waitUntil(promise: Promise<unknown>) {
          waitUntilPromises.push(promise);
        },
        passThroughOnException() {},
      } as never,
    );

    expect(res.status).toBe(200);
    await Promise.all(waitUntilPromises);
    expect(markMerchantInvoicePaidByCheckoutSession).not.toHaveBeenCalled();
  });
});
