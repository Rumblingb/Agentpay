jest.mock('../../apps/api-edge/src/lib/db', () => {
  const actual = jest.requireActual('../../apps/api-edge/src/lib/db');
  return {
    ...actual,
    createDb: jest.fn(),
  };
});

jest.mock('../../apps/api-edge/src/lib/fiatPayments', () => ({
  createHostedCardCheckout: jest.fn(),
  createHostedUpiPayment: jest.fn(),
  selectFiatProvider: jest.fn(() => 'razorpay'),
}));

jest.mock('../../apps/api-edge/src/lib/productSignals', () => ({
  recordProductSignalEvent: jest.fn().mockResolvedValue(undefined),
}));

import { createDb } from '../../apps/api-edge/src/lib/db';
import { createHostedCardCheckout, createHostedUpiPayment } from '../../apps/api-edge/src/lib/fiatPayments';
import apiEdge from '../../apps/api-edge/src/index';

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
    DATABASE_URL: 'postgres://agentpay:test@localhost:5432/agentpay',
    WEBHOOK_SECRET: 'w'.repeat(32),
    AGENTPAY_SIGNING_SECRET: 's'.repeat(32),
    VERIFICATION_SECRET: 'v'.repeat(32),
    ADMIN_SECRET_KEY: 'a'.repeat(32),
    CORS_ORIGIN: 'http://localhost:3000',
    API_BASE_URL: 'http://agentpay.test',
    FRONTEND_URL: 'http://agentpay.test',
    AGENTPAY_TEST_MODE: 'true',
    NODE_ENV: 'development',
    ...extra,
  } as never;
}

function authHeaders(extra: Record<string, string> = {}) {
  return {
    authorization: 'Bearer sk_test_sim',
    ...extra,
  };
}

function makeHostedActionRow(extra: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'action_session_1',
    merchant_id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
    action_type: 'funding_required',
    entity_type: 'funding_request',
    entity_id: 'fundreq_1',
    title: 'Complete payment with any UPI app',
    summary: 'Top up this purchase',
    status: 'pending',
    audience: 'generic',
    auth_type: 'mcp_token',
    resume_url: 'https://host.example.com/resume',
    display_payload_json: JSON.stringify({ kind: 'upi_qr' }),
    result_payload_json: JSON.stringify({}),
    metadata_json: JSON.stringify({ rail: 'upi_link' }),
    expires_at: new Date('2099-04-16T22:00:00.000Z'),
    completed_at: null,
    used_at: null,
    created_at: new Date('2099-04-16T21:30:00.000Z'),
    updated_at: new Date('2099-04-16T21:30:00.000Z'),
    ...extra,
  };
}

describe('hosted action session continuity', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (createDb as jest.Mock).mockReset();
    (createHostedCardCheckout as jest.Mock).mockReset();
    (createHostedUpiPayment as jest.Mock).mockReset();
  });

  it('creates a resumable action session for a human funding request', async () => {
    const sql = makeSql([
      [makeHostedActionRow()],
      [makeHostedActionRow()],
      [makeHostedActionRow({
        display_payload_json: JSON.stringify({
          kind: 'upi_qr',
          rail: 'upi_link',
          paymentLinkId: 'plink_1',
          shortUrl: 'https://rzp.io/i/demo',
          deepLink: 'upi://pay?pa=agentpay@razorpay',
          qrText: 'upi://pay?pa=agentpay@razorpay',
        }),
        metadata_json: JSON.stringify({
          rail: 'upi_link',
          provider: 'razorpay',
          requestId: 'fundreq_1',
          paymentLinkId: 'plink_1',
        }),
      })],
    ]);
    (createDb as jest.Mock).mockReturnValue(sql);
    (createHostedUpiPayment as jest.Mock).mockResolvedValue({
      provider: 'razorpay',
      paymentLinkId: 'plink_1',
      shortUrl: 'https://rzp.io/i/demo',
      upiQrString: 'upi://pay?pa=agentpay@razorpay',
    });

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/payments/funding-request', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          amountInr: 499,
          description: 'Top up this purchase',
          resumeUrl: 'https://host.example.com/resume',
        }),
      }),
      appEnv({
        RAZORPAY_KEY_ID: 'rzp_test_key',
        RAZORPAY_KEY_SECRET: 'rzp_test_secret',
      }),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(201);
    expect(body.status).toBe('requires_human_funding');
    expect(body.actionSession).toEqual(expect.objectContaining({
      sessionId: 'action_session_1',
      status: 'pending',
      statusUrl: 'http://agentpay.test/api/actions/action_session_1',
    }));
    expect((body.nextAction as Record<string, unknown>).displayPayload).toEqual(expect.objectContaining({
      actionSessionId: 'action_session_1',
      actionStatusUrl: 'http://agentpay.test/api/actions/action_session_1',
    }));
    expect(createHostedUpiPayment).toHaveBeenCalledTimes(1);
    expect((createHostedUpiPayment as jest.Mock).mock.calls[0][1]).toEqual(expect.objectContaining({
      callbackUrl: expect.stringContaining('http://agentpay.test/api/actions/action_session_1/resume?token='),
    }));
    expect(sql).toHaveBeenCalledTimes(3);
  });

  it('marks the action session failed if hosted UPI link creation fails after session creation', async () => {
    const sql = makeSql([
      [makeHostedActionRow()],
      [makeHostedActionRow()],
      [makeHostedActionRow({
        status: 'failed',
        completed_at: new Date('2099-04-16T21:35:00.000Z'),
        result_payload_json: JSON.stringify({
          provider: 'razorpay',
          failureReason: 'payment_link_creation_failed',
        }),
      })],
    ]);
    (createDb as jest.Mock).mockReturnValue(sql);
    (createHostedUpiPayment as jest.Mock).mockResolvedValue(null);

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/payments/funding-request', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          amountInr: 499,
          description: 'Top up this purchase',
          resumeUrl: 'https://host.example.com/resume',
        }),
      }),
      appEnv({
        RAZORPAY_KEY_ID: 'rzp_test_key',
        RAZORPAY_KEY_SECRET: 'rzp_test_secret',
      }),
      {} as never,
    );

    await expect(res.json()).resolves.toEqual({
      error: 'Failed to create hosted UPI funding request',
    });
    expect(res.status).toBe(502);
    expect(sql).toHaveBeenCalledTimes(3);
  });

  it('creates a resumable card checkout funding request when Stripe is configured', async () => {
    const sql = makeSql([
      [makeHostedActionRow({
        title: 'Complete payment by card',
        display_payload_json: JSON.stringify({ kind: 'stripe_checkout' }),
        metadata_json: JSON.stringify({ rail: 'card_checkout' }),
      })],
      [makeHostedActionRow({
        title: 'Complete payment by card',
        display_payload_json: JSON.stringify({ kind: 'stripe_checkout' }),
        metadata_json: JSON.stringify({ rail: 'card_checkout' }),
      })],
      [makeHostedActionRow({
        title: 'Complete payment by card',
        display_payload_json: JSON.stringify({
          kind: 'stripe_checkout',
          rail: 'card_checkout',
          checkoutUrl: 'https://checkout.stripe.com/c/pay/demo',
          checkoutSessionId: 'cs_test_123',
        }),
        metadata_json: JSON.stringify({
          rail: 'card_checkout',
          provider: 'stripe',
          requestId: 'fundreq_1',
          checkoutSessionId: 'cs_test_123',
          currency: 'GBP',
        }),
      })],
    ]);
    (createDb as jest.Mock).mockReturnValue(sql);
    (createHostedCardCheckout as jest.Mock).mockResolvedValue({
      provider: 'stripe',
      checkoutSessionId: 'cs_test_123',
      checkoutUrl: 'https://checkout.stripe.com/c/pay/demo',
      expiresAt: '2099-04-16T22:00:00.000Z',
    });

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/payments/funding-request', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          amount: 49,
          currency: 'GBP',
          description: 'Top up this purchase',
          resumeUrl: 'https://host.example.com/resume',
        }),
      }),
      appEnv({
        STRIPE_SECRET_KEY: 'sk_test_123',
      }),
      {} as never,
    );

    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(201);
    expect(body.status).toBe('requires_human_funding');
    expect(body.rail).toBe('card');
    expect(body.provider).toBe('stripe');
    expect(body.actionSession).toEqual(expect.objectContaining({
      sessionId: 'action_session_1',
      status: 'pending',
      statusUrl: 'http://agentpay.test/api/actions/action_session_1',
    }));
    expect((body.nextAction as Record<string, unknown>).displayPayload).toEqual(expect.objectContaining({
      kind: 'stripe_checkout',
      checkoutUrl: 'https://checkout.stripe.com/c/pay/demo',
      checkoutSessionId: 'cs_test_123',
      actionSessionId: 'action_session_1',
    }));
    expect(createHostedCardCheckout).toHaveBeenCalledTimes(1);
    expect((createHostedCardCheckout as jest.Mock).mock.calls[0][1]).toEqual(expect.objectContaining({
      amount: 49,
      currency: 'GBP',
      successUrl: expect.stringContaining('status=completed'),
      cancelUrl: expect.stringContaining('status=failed'),
      metadata: expect.objectContaining({
        actionSessionId: 'action_session_1',
      }),
    }));
    expect(sql).toHaveBeenCalledTimes(3);
  });

  it('completes a hosted action session through the public resume callback and redirects back to the host', async () => {
    (createDb as jest.Mock).mockReturnValue(makeSql([[
      makeHostedActionRow({
        status: 'completed',
        completed_at: new Date('2099-04-16T21:45:00.000Z'),
        used_at: new Date('2099-04-16T21:45:00.000Z'),
        result_payload_json: JSON.stringify({
          razorpay_payment_link_status: 'paid',
        }),
      }),
    ]]));

    const res = await apiEdge.fetch(
      new Request('http://agentpay.test/api/actions/action_session_1/resume?token=apas_test_token&razorpay_payment_link_status=paid'),
      appEnv(),
      {} as never,
    );

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('https://host.example.com/resume');
    expect(location).toContain('agentpayActionSessionId=action_session_1');
    expect(location).toContain('agentpayActionStatus=completed');
    expect(location).toContain('agentpayActionType=funding_required');
  });
});
