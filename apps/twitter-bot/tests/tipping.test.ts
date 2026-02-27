/**
 * Tests for the tipping handler.
 */

jest.mock('twitter-api-v2', () => ({
  TwitterApi: jest.fn().mockImplementation(() => ({
    v2: {
      reply: jest.fn(),
    },
  })),
}));

import { handleTipMention, TippingHandlerConfig } from '../src/handlers/tipping';
import { AgentPayClient } from '../src/clients/agentpayClient';
import type { TweetV2 } from 'twitter-api-v2';

const makeTweet = (text: string, id = 'tweet_001'): TweetV2 =>
  ({ id, text } as TweetV2);

function makeConfig(overrides: Partial<TippingHandlerConfig> = {}): TippingHandlerConfig {
  const mockReply = jest.fn().mockResolvedValue({ data: { id: 'reply_001' } });
  const mockTwitterClient: any = { v2: { reply: mockReply } };
  const mockAgentPay: any = {
    createTipIntent: jest.fn().mockResolvedValue({
      success: true,
      tipId: 'tip_abc123',
    }),
    getTipPageUrl: jest.fn().mockReturnValue('https://pay.agentpay.io/tip/streamer1'),
  };

  return {
    twitterClient: mockTwitterClient,
    agentPayClient: mockAgentPay as AgentPayClient,
    botHandle: 'agentpaybot',
    ...overrides,
  };
}

describe('handleTipMention', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns handled:false for non-tip tweets', async () => {
    const config = makeConfig();
    const result = await handleTipMention(makeTweet('hello world'), 'alice', config);
    expect(result.handled).toBe(false);
  });

  it('returns handled:false for paylink commands', async () => {
    const config = makeConfig();
    const result = await handleTipMention(makeTweet('!paylink streamer1'), 'alice', config);
    expect(result.handled).toBe(false);
  });

  it('creates a tip intent and replies for valid !tip command', async () => {
    const config = makeConfig();
    const tweet = makeTweet('!tip @streamer1 10 USDC great stream!');

    const result = await handleTipMention(tweet, 'alice', config);

    expect(result.handled).toBe(true);
    expect(result.tweetId).toBe('reply_001');
    expect(config.agentPayClient.createTipIntent).toHaveBeenCalledWith(
      'streamer1',
      10,
      'USDC'
    );
    expect(config.twitterClient.v2.reply).toHaveBeenCalledWith(
      expect.stringContaining('Tip intent created'),
      'tweet_001'
    );
  });

  it('replies with error message for invalid amount (too large)', async () => {
    const config = makeConfig();
    const tweet = makeTweet('!tip @streamer1 99999999 USDC');

    const result = await handleTipMention(tweet, 'alice', config);

    expect(result.handled).toBe(true);
    expect(config.agentPayClient.createTipIntent).not.toHaveBeenCalled();
    expect(config.twitterClient.v2.reply).toHaveBeenCalledWith(
      expect.stringContaining('Invalid tip amount'),
      'tweet_001'
    );
  });

  it('defaults to USDC when currency is not specified', async () => {
    const config = makeConfig();
    const tweet = makeTweet('!tip @streamer1 5');

    await handleTipMention(tweet, 'alice', config);

    expect(config.agentPayClient.createTipIntent).toHaveBeenCalledWith(
      'streamer1',
      5,
      'USDC'
    );
  });

  it('captures error when API call fails', async () => {
    const config = makeConfig();
    (config.agentPayClient.createTipIntent as jest.Mock).mockRejectedValueOnce(
      new Error('Network error')
    );
    const tweet = makeTweet('!tip @streamer1 10 USDC');

    const result = await handleTipMention(tweet, 'alice', config);

    expect(result.handled).toBe(true);
    expect(result.error).toBe('Network error');
  });
});
