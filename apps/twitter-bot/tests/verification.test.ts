/**
 * Tests for the verification handler.
 */

jest.mock('twitter-api-v2', () => ({
  TwitterApi: jest.fn().mockImplementation(() => ({
    v2: {
      reply: jest.fn(),
    },
  })),
}));

import { handleVerifyMention, VerificationHandlerConfig } from '../src/handlers/verification';
import { AgentPayClient } from '../src/clients/agentpayClient';
import type { TweetV2 } from 'twitter-api-v2';

const makeTweet = (text: string, id = 'tweet_001'): TweetV2 =>
  ({ id, text } as TweetV2);

// A realistic Solana tx hash (base58, 87 chars)
const VALID_TX = '5KtSyQPmKXkZ1J7VrALLNdQmC5h3iVxv3JNmVtJy6HWuLHxMaFGM4LdFhZYg9QBrRmJkRRaWMHdKHrV1GBpJvN';

function makeConfig(overrides: Partial<VerificationHandlerConfig> = {}): VerificationHandlerConfig {
  const mockReply = jest.fn().mockResolvedValue({ data: { id: 'reply_001' } });
  const mockTwitterClient: any = { v2: { reply: mockReply } };
  const mockAgentPay: any = {
    verifyTip: jest.fn().mockResolvedValue({ success: true, valid: true, transactionId: 'tip_abc' }),
  };

  return {
    twitterClient: mockTwitterClient,
    agentPayClient: mockAgentPay as AgentPayClient,
    botHandle: 'agentpaybot',
    ...overrides,
  };
}

describe('handleVerifyMention', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns handled:false for non-verify tweets', async () => {
    const config = makeConfig();
    const result = await handleVerifyMention(makeTweet('hello world'), 'alice', config);
    expect(result.handled).toBe(false);
  });

  it('verifies a valid tx hash and replies with success', async () => {
    const config = makeConfig();
    const tweet = makeTweet(`!verify ${VALID_TX}`);

    const result = await handleVerifyMention(tweet, 'alice', config);

    expect(result.handled).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.tweetId).toBe('reply_001');
    expect(config.agentPayClient.verifyTip).toHaveBeenCalledWith(VALID_TX);
    expect(config.twitterClient.v2.reply).toHaveBeenCalledWith(
      expect.stringContaining('Payment verified'),
      'tweet_001'
    );
  });

  it('replies with failure when verification fails', async () => {
    const config = makeConfig();
    (config.agentPayClient.verifyTip as jest.Mock).mockResolvedValueOnce({
      success: false,
      valid: false,
      error: 'Transaction not found',
    });
    const tweet = makeTweet(`!verify ${VALID_TX}`);

    const result = await handleVerifyMention(tweet, 'alice', config);

    expect(result.handled).toBe(true);
    expect(result.valid).toBe(false);
    expect(config.twitterClient.v2.reply).toHaveBeenCalledWith(
      expect.stringContaining('could not be verified'),
      'tweet_001'
    );
  });

  it('captures error when API call throws', async () => {
    const config = makeConfig();
    (config.agentPayClient.verifyTip as jest.Mock).mockRejectedValueOnce(
      new Error('Timeout')
    );
    const tweet = makeTweet(`!verify ${VALID_TX}`);

    const result = await handleVerifyMention(tweet, 'alice', config);

    expect(result.handled).toBe(true);
    expect(result.error).toBe('Timeout');
  });
});
