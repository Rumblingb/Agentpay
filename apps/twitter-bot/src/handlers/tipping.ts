/**
 * Tipping handler for the AgentPay Twitter bot.
 * Listens for !tip commands in mentions and creates tip intents.
 */

import { TwitterApi, TweetV2 } from 'twitter-api-v2';
import { parseMention, isValidAmount } from '../utils/tweetParser';
import { AgentPayClient } from '../clients/agentpayClient';

export interface TippingHandlerConfig {
  twitterClient: TwitterApi;
  agentPayClient: AgentPayClient;
  botHandle: string;
}

export interface HandleTipResult {
  handled: boolean;
  tweetId?: string;
  error?: string;
}

/**
 * Handles a tweet that mentions the bot with a !tip command.
 * Creates a tip intent and replies with a payment link.
 */
export async function handleTipMention(
  tweet: TweetV2,
  authorUsername: string,
  config: TippingHandlerConfig
): Promise<HandleTipResult> {
  const text = tweet.text || '';
  const parsed = parseMention(text);

  if (parsed.type !== 'tip' || !parsed.tipCommand) {
    return { handled: false };
  }

  const { amount, currency, recipient } = parsed.tipCommand;

  if (!isValidAmount(amount)) {
    try {
      const reply = await config.twitterClient.v2.reply(
        `@${authorUsername} ❌ Invalid tip amount. Please use a positive value (e.g., !tip @${recipient} 5 USDC).`,
        tweet.id
      );
      return { handled: true, tweetId: reply.data.id };
    } catch (err: any) {
      return { handled: true, error: err.message };
    }
  }

  try {
    const intent = await config.agentPayClient.createTipIntent(
      recipient,
      amount,
      currency
    );

    const tipUrl = config.agentPayClient.getTipPageUrl(recipient);

    const replyText =
      `@${authorUsername} 💸 Tip intent created!\n` +
      `Send ${amount} ${currency} to @${recipient}\n` +
      `Pay here: ${tipUrl}\n` +
      `Tip ID: ${intent.tipId}`;

    const reply = await config.twitterClient.v2.reply(replyText, tweet.id);
    return { handled: true, tweetId: reply.data.id };
  } catch (err: any) {
    return { handled: true, error: err.message };
  }
}
