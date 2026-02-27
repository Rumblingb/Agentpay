/**
 * tipping.test.ts – Tests for the handleTip handler.
 * All external dependencies (Twitter API, AgentPay client) are mocked.
 */

import { handleTip } from '../src/handlers/tipping';
import type { TipCommand } from '../src/services/tweetParser';
import type { TipContext } from '../src/handlers/tipping';

// Minimal mocks ──────────────────────────────────────────────────────────────

const mockReply = jest.fn().mockResolvedValue({});
const mockSendDm = jest.fn().mockResolvedValue({});

const mockTwitter = {
  v2: {
    reply: mockReply,
    sendDmToParticipant: mockSendDm,
  },
} as any;

function makeAgentpayMock(overrides: Partial<{
  limitAllowed: boolean;
  intentResponse: Record<string, unknown>;
  intentThrows: boolean;
}> = {}) {
  const { limitAllowed = true, intentResponse = { intentId: 'ix1', paymentUrl: 'https://pay.agentpay.dev/ix1' }, intentThrows = false } = overrides;
  return {
    enforceDailyLimit: jest.fn().mockResolvedValue(limitAllowed),
    createIntent: intentThrows
      ? jest.fn().mockRejectedValue(new Error('API error'))
      : jest.fn().mockResolvedValue({ success: true, ...intentResponse }),
  } as any;
}

const baseCmd: TipCommand = {
  type: 'tip',
  amount: 0.25,
  currency: 'USDC',
  recipient: '@alice',
};

const baseCtx: TipContext = {
  tweetId: 'tweet_001',
  senderUserId: 'u_sender',
  senderHandle: 'bob',
  merchantId: 'merchant_uuid',
  agentId: 'agent_bob',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('handleTip – daily limit', () => {
  test('replies with limit-exceeded message when enforceDailyLimit returns false', async () => {
    await handleTip(mockTwitter, makeAgentpayMock({ limitAllowed: false }), baseCmd, baseCtx);
    expect(mockReply).toHaveBeenCalledWith(
      expect.stringContaining('daily spend limit'),
      baseCtx.tweetId,
    );
  });
});

describe('handleTip – normal flow', () => {
  test('posts a Pay Now reply with the payment URL', async () => {
    await handleTip(mockTwitter, makeAgentpayMock(), baseCmd, baseCtx);
    expect(mockReply).toHaveBeenCalledWith(
      expect.stringContaining('https://pay.agentpay.dev/ix1'),
      baseCtx.tweetId,
    );
  });

  test('reply contains amount and currency', async () => {
    await handleTip(mockTwitter, makeAgentpayMock(), baseCmd, baseCtx);
    const [[text]] = mockReply.mock.calls;
    expect(text).toContain('0.25');
    expect(text).toContain('USDC');
  });
});

describe('handleTip – PIN / delegation required', () => {
  test('sends DM and posts authorization-required reply when requiresPin=true', async () => {
    const agentpay = makeAgentpayMock({
      intentResponse: { intentId: 'ix2', paymentUrl: 'https://pay.agentpay.dev/ix2', requiresPin: true },
    });
    await handleTip(mockTwitter, agentpay, baseCmd, baseCtx);
    expect(mockSendDm).toHaveBeenCalledWith(
      baseCtx.senderUserId,
      expect.objectContaining({ text: expect.stringContaining('PIN required') }),
    );
    expect(mockReply).toHaveBeenCalledWith(
      expect.stringContaining('Authorization required'),
      baseCtx.tweetId,
    );
  });

  test('gracefully handles DM failure and still posts public reply', async () => {
    mockSendDm.mockRejectedValueOnce(new Error('DM blocked'));
    const agentpay = makeAgentpayMock({
      intentResponse: { intentId: 'ix3', requiresDelegation: true },
    });
    await handleTip(mockTwitter, agentpay, baseCmd, baseCtx);
    expect(mockReply).toHaveBeenCalledWith(
      expect.stringContaining('Authorization required'),
      baseCtx.tweetId,
    );
  });
});

describe('handleTip – API error', () => {
  test('replies with error message when createIntent throws', async () => {
    await handleTip(mockTwitter, makeAgentpayMock({ intentThrows: true }), baseCmd, baseCtx);
    expect(mockReply).toHaveBeenCalledWith(
      expect.stringContaining('Payment failed'),
      baseCtx.tweetId,
    );
  });
});
