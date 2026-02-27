/**
 * payLinks.test.ts – Tests for the #paywall handler.
 */

import { handlePaywall } from '../src/handlers/payLinks';
import type { PaywallCommand } from '../src/services/tweetParser';
import type { PaywallContext } from '../src/handlers/payLinks';

const mockReply = jest.fn().mockResolvedValue({});
const mockTwitter = { v2: { reply: mockReply } } as any;

const baseCmd: PaywallCommand = {
  type: 'paywall',
  amount: 0.05,
  currency: 'USDC',
};

const baseCtx: PaywallContext = {
  tweetId: 'tweet_paywall_1',
  authorUserId: 'u_author',
  authorHandle: 'content_creator',
  merchantId: 'merchant_uuid',
  botAgentId: 'bot_agent',
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AGENTPAY_BASE_URL = 'https://api.agentpay.dev';
});

describe('handlePaywall', () => {
  test('replies with unlock message and pay URL when intent is created', async () => {
    const agentpay = {
      createIntent: jest.fn().mockResolvedValue({
        intentId: 'pw1',
        paymentUrl: 'https://pay.agentpay.dev/pw1',
      }),
    } as any;

    await handlePaywall(mockTwitter, agentpay, baseCmd, baseCtx);

    expect(mockReply).toHaveBeenCalledWith(
      expect.stringContaining('Unlock this content for $0.05'),
      'tweet_paywall_1',
    );
    expect(mockReply.mock.calls[0][0]).toContain('https://pay.agentpay.dev/pw1');
  });

  test('falls back to tip URL when createIntent throws', async () => {
    const agentpay = {
      createIntent: jest.fn().mockRejectedValue(new Error('API down')),
    } as any;

    await handlePaywall(mockTwitter, agentpay, baseCmd, baseCtx);

    const [[text]] = mockReply.mock.calls;
    expect(text).toContain('Unlock this content for $0.05');
    expect(text).toContain('content_creator');
  });

  test('reply includes currency', async () => {
    const agentpay = {
      createIntent: jest.fn().mockResolvedValue({ intentId: 'pw2', paymentUrl: 'https://p.dev/pw2' }),
    } as any;

    await handlePaywall(mockTwitter, agentpay, { ...baseCmd, currency: 'USDC' }, baseCtx);

    expect(mockReply.mock.calls[0][0]).toContain('USDC');
  });
});
