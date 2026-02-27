/**
 * verification.test.ts – Tests for the post-payment verification handler.
 */

import { handleVerification } from '../src/handlers/verification';
import type { VerificationContext } from '../src/handlers/verification';

const mockReply = jest.fn().mockResolvedValue({});
const mockTweet = jest.fn().mockResolvedValue({});
const mockTwitter = { v2: { reply: mockReply, tweet: mockTweet } } as any;

const baseCtx: VerificationContext = {
  txHash: '4xYz1234567890abcdef',
  amountUsd: 0.25,
  currency: 'USDC',
  senderHandle: 'alice',
  senderAgentId: 'agent_alice',
  receiverHandle: 'bob',
  replyToTweetId: 'tweet_001',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('handleVerification', () => {
  test('posts a verified reply to the original tweet', async () => {
    const agentpay = {
      getVerification: jest.fn().mockResolvedValue({ verified: true, certificate: { id: 'c1', signature: 'abcdef1234567890' } }),
      getReputation: jest.fn().mockResolvedValue({ trustScore: 85, totalPayments: 10, successRate: 0.9, fastTrackEligible: true }),
    } as any;

    await handleVerification(mockTwitter, agentpay, baseCtx);

    expect(mockReply).toHaveBeenCalledWith(
      expect.stringContaining('Payment Verified'),
      'tweet_001',
    );
  });

  test('includes txHash truncated in the tweet', async () => {
    const agentpay = {
      getVerification: jest.fn().mockResolvedValue({ verified: true, certificate: {} }),
      getReputation: jest.fn().mockResolvedValue(null),
    } as any;

    await handleVerification(mockTwitter, agentpay, baseCtx);

    const [[text]] = mockReply.mock.calls;
    expect(text).toContain('4xYz1234567890abcde');
  });

  test('includes sender and receiver handles', async () => {
    const agentpay = {
      getVerification: jest.fn().mockResolvedValue({ verified: false }),
      getReputation: jest.fn().mockResolvedValue(null),
    } as any;

    await handleVerification(mockTwitter, agentpay, baseCtx);

    const [[text]] = mockReply.mock.calls;
    expect(text).toContain('@alice');
    expect(text).toContain('@bob');
  });

  test('includes reputation score when available', async () => {
    const agentpay = {
      getVerification: jest.fn().mockResolvedValue({ verified: true, certificate: {} }),
      getReputation: jest.fn().mockResolvedValue({ trustScore: 108 }),
    } as any;

    await handleVerification(mockTwitter, agentpay, baseCtx);

    const [[text]] = mockReply.mock.calls;
    expect(text).toContain('108');
  });

  test('posts a new tweet when replyToTweetId is not provided', async () => {
    const agentpay = {
      getVerification: jest.fn().mockResolvedValue({ verified: true, certificate: {} }),
      getReputation: jest.fn().mockResolvedValue(null),
    } as any;

    await handleVerification(mockTwitter, agentpay, { ...baseCtx, replyToTweetId: undefined });

    expect(mockTweet).toHaveBeenCalled();
    expect(mockReply).not.toHaveBeenCalled();
  });

  test('handles getVerification failure gracefully', async () => {
    const agentpay = {
      getVerification: jest.fn().mockRejectedValue(new Error('Network error')),
      getReputation: jest.fn().mockResolvedValue(null),
    } as any;

    await expect(
      handleVerification(mockTwitter, agentpay, baseCtx),
    ).resolves.not.toThrow();

    expect(mockReply).toHaveBeenCalledWith(
      expect.stringContaining('certificate unavailable'),
      'tweet_001',
    );
  });
});
