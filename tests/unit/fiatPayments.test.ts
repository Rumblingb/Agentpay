jest.mock('../../apps/api-edge/src/lib/razorpay', () => ({
  createUpiPaymentLink: jest.fn(),
}));

jest.mock('../../apps/api-edge/src/lib/airwallex', () => ({
  AirwallexClient: jest.fn().mockImplementation(() => ({
    createPaymentIntent: jest.fn().mockResolvedValue({
      id: 'awx_pi_123',
      clientSecret: 'client_secret_123',
      status: 'SUCCEEDED',
    }),
  })),
  formatAirwallexStatus: jest.fn((status: string) => status === 'SUCCEEDED' ? 'succeeded' : 'pending'),
}));

import { createUpiPaymentLink } from '../../apps/api-edge/src/lib/razorpay';
import { createDirectPaymentIntent, createHostedUpiPayment, getConfiguredFiatProviders, selectFiatProvider } from '../../apps/api-edge/src/lib/fiatPayments';

describe('fiatPayments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('detects configured providers and rails', () => {
    const providers = getConfiguredFiatProviders({
      RAZORPAY_KEY_ID: 'rzp_id',
      RAZORPAY_KEY_SECRET: 'rzp_secret',
      AIRWALLEX_CLIENT_ID: 'awx_id',
      AIRWALLEX_API_KEY: 'awx_secret',
      STRIPE_SECRET_KEY: 'sk_test',
    } as never);

    expect(providers).toEqual([
      { provider: 'razorpay', rails: ['upi_link'] },
      { provider: 'airwallex', rails: ['upi_intent', 'card'] },
      { provider: 'stripe', rails: ['card'] },
    ]);
    expect(selectFiatProvider({ AIRWALLEX_CLIENT_ID: 'awx', AIRWALLEX_API_KEY: 'secret' } as never, 'upi_intent')).toBe('airwallex');
  });

  it('routes hosted UPI creation through Razorpay when configured', async () => {
    (createUpiPaymentLink as jest.Mock).mockResolvedValue({
      id: 'plink_123',
      shortUrl: 'https://rzp.test/pay',
      status: 'created',
      expiresAt: '2030-01-01T00:00:00Z',
    });

    const result = await createHostedUpiPayment({
      RAZORPAY_KEY_ID: 'rzp_id',
      RAZORPAY_KEY_SECRET: 'rzp_secret',
    } as never, {
      amountInr: 1000,
      description: 'Test booking',
      customerName: 'Test User',
      customerEmail: 'test@example.com',
      notes: {},
    });

    expect(result).toMatchObject({
      provider: 'razorpay',
      id: 'plink_123',
    });
  });

  it('creates a normalized Airwallex direct intent when configured', async () => {
    const result = await createDirectPaymentIntent({
      AIRWALLEX_CLIENT_ID: 'awx_id',
      AIRWALLEX_API_KEY: 'awx_secret',
      AIRWALLEX_SANDBOX: 'true',
    } as never, {
      amount: 42,
      currency: 'GBP',
      descriptor: 'AgentPay',
      orderId: 'order_123',
      returnUrl: 'https://agentpay.test/return',
    });

    expect(result).toEqual({
      provider: 'airwallex',
      id: 'awx_pi_123',
      clientSecret: 'client_secret_123',
      rawStatus: 'SUCCEEDED',
      status: 'succeeded',
    });
  });
});
