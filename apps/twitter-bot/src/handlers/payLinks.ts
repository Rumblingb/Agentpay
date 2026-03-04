/**
 * Pay-link handler for the AgentPay Twitter bot.
 * Handles !paylink commands to generate overlay/tip page links for streamers.
 */

import { TwitterApi, TweetV2 } from 'twitter-api-v2';
import { parseMention } from '../utils/tweetParser';
import { AgentPayClient } from '../clients/agentpayClient';

export interface PayLinksHandlerConfig {
  twitterClient: TwitterApi;
  agentPayClient: AgentPayClient;
  botHandle: string;
}

export interface HandlePayLinkResult {
  handled: boolean;
  tweetId?: string;
  overlayUrl?: string;
  tipUrl?: string;
  error?: string;
}

/**
 * Handles a tweet that mentions the bot with a !paylink command.
 * Replies with the streamer's overlay URL and tip page link.
 */
export async function handlePayLinkMention(
  tweet: TweetV2,
  authorUsername: string,
  config: PayLinksHandlerConfig
): Promise<HandlePayLinkResult> {
  const text = tweet.text || '';
  const parsed = parseMention(text);

  if (parsed.type !== 'paylink' || !parsed.payLinkCode) {
    return { handled: false };
  }

  const streamerId = parsed.payLinkCode;

  try {
    const overlayUrl = config.agentPayClient.getOverlayUrl(streamerId);
    const tipUrl = config.agentPayClient.getTipPageUrl(streamerId);

    const replyText =
      `@${authorUsername} 🎮 Streamer links for ${streamerId}:\n` +
      `💰 Tip page: ${tipUrl}\n` +
      `🖥️ Overlay: ${overlayUrl}`;

    const reply = await config.twitterClient.v2.reply(replyText, tweet.id);
    return { handled: true, tweetId: reply.data.id, overlayUrl, tipUrl };
  } catch (err: any) {
    return { handled: true, error: err.message };
  }
}
