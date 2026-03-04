/**
 * Tests for the pay-link handler.
 */

jest.mock('twitter-api-v2', () => ({
  TwitterApi: jest.fn().mockImplementation(() => ({
    v2: {
      reply: jest.fn(),
    },
  })),
}));

import { handlePayLinkMention, PayLinksHandlerConfig } from '../src/handlers/payLinks';
import { AgentPayClient } from '../src/clients/agentpayClient';
import type { TweetV2 } from 'twitter-api-v2';

const makeTweet = (text: string, id = 'tweet_001'): TweetV2 =>
  ({ id, text } as TweetV2);

function makeConfig(overrides: Partial<PayLinksHandlerConfig> = {}): PayLinksHandlerConfig {
  const mockReply = jest.fn().mockResolvedValue({ data: { id: 'reply_001' } });
  const mockTwitterClient: any = { v2: { reply: mockReply } };
  const mockAgentPay: any = {
    getOverlayUrl: jest.fn().mockReturnValue('https://pay.agentpay.io/overlay/streamer1'),
    getTipPageUrl: jest.fn().mockReturnValue('https://pay.agentpay.io/tip/streamer1'),
  };

  return {
    twitterClient: mockTwitterClient,
    agentPayClient: mockAgentPay as AgentPayClient,
    botHandle: 'agentpaybot',
    ...overrides,
  };
}

describe('handlePayLinkMention', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns handled:false for non-paylink tweets', async () => {
    const config = makeConfig();
    const result = await handlePayLinkMention(makeTweet('hello world'), 'alice', config);
    expect(result.handled).toBe(false);
  });

  it('returns handled:false for tip commands', async () => {
    const config = makeConfig();
    const result = await handlePayLinkMention(makeTweet('!tip @streamer1 10 USDC'), 'alice', config);
    expect(result.handled).toBe(false);
  });

  it('generates overlay and tip URLs for valid !paylink command', async () => {
    const config = makeConfig();
    const tweet = makeTweet('!paylink streamer1');

    const result = await handlePayLinkMention(tweet, 'alice', config);

    expect(result.handled).toBe(true);
    expect(result.tweetId).toBe('reply_001');
    expect(result.overlayUrl).toBe('https://pay.agentpay.io/overlay/streamer1');
    expect(result.tipUrl).toBe('https://pay.agentpay.io/tip/streamer1');
    expect(config.agentPayClient.getOverlayUrl).toHaveBeenCalledWith('streamer1');
    expect(config.agentPayClient.getTipPageUrl).toHaveBeenCalledWith('streamer1');
    expect(config.twitterClient.v2.reply).toHaveBeenCalledWith(
      expect.stringContaining('Streamer links'),
      'tweet_001'
    );
  });

  it('includes both URLs in the reply text', async () => {
    const config = makeConfig();
    const tweet = makeTweet('!paylink streamer1');

    await handlePayLinkMention(tweet, 'alice', config);

    const replyCall = (config.twitterClient.v2.reply as jest.Mock).mock.calls[0][0] as string;
    expect(replyCall).toContain('tip/streamer1');
    expect(replyCall).toContain('overlay/streamer1');
  });

  it('captures error when Twitter reply fails', async () => {
    const config = makeConfig();
    (config.twitterClient.v2.reply as jest.Mock).mockRejectedValueOnce(
      new Error('Rate limit exceeded')
    );
    const tweet = makeTweet('!paylink streamer1');

    const result = await handlePayLinkMention(tweet, 'alice', config);

    expect(result.handled).toBe(true);
    expect(result.error).toBe('Rate limit exceeded');
  });
});
