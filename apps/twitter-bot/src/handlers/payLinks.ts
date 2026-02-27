/**
 * payLinks.ts
 *
 * Handles the #paywall command: tweets that contain `#paywall $<amount>`.
 * Replies with a "Unlock this content" message and a pay link generated
 * by the AgentPay API.
 */

import { TwitterApi } from 'twitter-api-v2';
import type { AgentPayClient } from '../services/agentpayClient.js';
import type { PaywallCommand } from '../services/tweetParser.js';

export interface PaywallContext {
  /** Tweet ID that contains the #paywall tag. */
  tweetId: string;
  /** Twitter user ID of the content author who embedded the paywall. */
  authorUserId: string;
  /** Twitter @handle of the author (without @). */
  authorHandle: string;
  /** AgentPay merchant ID for the author. */
  merchantId: string;
  /** AgentPay agent ID for the bot itself. */
  botAgentId: string;
}

/**
 * Handle a #paywall command.
 * Generates a pay link and replies to the tweet.
 */
export async function handlePaywall(
  twitter: TwitterApi,
  agentpay: AgentPayClient,
  cmd: PaywallCommand,
  ctx: PaywallContext,
): Promise<void> {
  let payUrl: string;

  try {
    const intent = await agentpay.createIntent({
      merchantId: ctx.merchantId,
      agentId: ctx.botAgentId,
      amount: cmd.amount,
      currency: cmd.currency,
      metadata: { source: 'twitter-paywall', tweetId: ctx.tweetId },
    });
    payUrl = intent.paymentUrl ?? `${process.env.AGENTPAY_BASE_URL}/pay/${intent.intentId}`;
  } catch {
    payUrl = `${process.env.AGENTPAY_BASE_URL}/tip/${ctx.authorHandle}?amount=${cmd.amount}`;
  }

  await twitter.v2.reply(
    `🔒 Unlock this content for $${cmd.amount} ${cmd.currency} via AgentPay:\n${payUrl}`,
    ctx.tweetId,
  );
}
