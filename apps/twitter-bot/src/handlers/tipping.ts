/**
 * tipping.ts
 *
 * Handles tip / send / pay commands parsed from incoming tweet mentions.
 * Flow:
 *   1. Enforce daily spend limit.
 *   2. Create a PaymentIntent via the AgentPay API.
 *   3. If PIN/delegation required → send approval DM.
 *   4. Post a public "Pay Now" reply with the payment link.
 */

import { TwitterApi } from 'twitter-api-v2';
import type { AgentPayClient } from '../services/agentpayClient.js';
import type { TipCommand } from '../services/tweetParser.js';

export interface TipContext {
  /** Numeric tweet ID that triggered the command. */
  tweetId: string;
  /** Twitter user ID of the person who sent the command. */
  senderUserId: string;
  /** Twitter @handle of the sender (without @). */
  senderHandle: string;
  /** Merchant / recipient AgentPay ID (mapped from the @username). */
  merchantId: string;
  /** AgentPay agent ID for the sender. */
  agentId: string;
}

/**
 * Process a tip/send/pay command.
 * Posts a public reply and (when required) sends a DM with an approval link.
 */
export async function handleTip(
  twitter: TwitterApi,
  agentpay: AgentPayClient,
  cmd: TipCommand,
  ctx: TipContext,
): Promise<void> {
  // 1. Enforce daily limit
  const allowed = await agentpay.enforceDailyLimit(ctx.senderUserId, cmd.amount);
  if (!allowed) {
    await twitter.v2.reply(
      `@${ctx.senderHandle} ❌ You've reached your daily spend limit. Try again tomorrow.`,
      ctx.tweetId,
    );
    return;
  }

  // 2. Create payment intent
  let intent;
  try {
    intent = await agentpay.createIntent({
      merchantId: ctx.merchantId,
      agentId: ctx.agentId,
      amount: cmd.amount,
      currency: cmd.currency,
      metadata: {
        source: 'twitter-bot',
        senderHandle: ctx.senderHandle,
        recipient: cmd.recipient ?? 'author',
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await twitter.v2.reply(
      `@${ctx.senderHandle} ❌ Payment failed to initialise: ${msg}`,
      ctx.tweetId,
    );
    return;
  }

  // 3. If PIN / delegation required → DM the sender
  if (intent.requiresPin || intent.requiresDelegation) {
    const approvalUrl = intent.paymentUrl ?? `${process.env.AGENTPAY_BASE_URL}/approve/${intent.intentId}`;
    try {
      await twitter.v2.sendDmToParticipant(ctx.senderUserId, {
        text: `🔐 AgentPay PIN required\n\nClick to approve your $${cmd.amount} payment:\n${approvalUrl}`,
      });
    } catch {
      // DM may fail if the user doesn't follow the bot; fall through to public reply
    }
    await twitter.v2.reply(
      `@${ctx.senderHandle} 🔐 Authorization required. Check your DMs to approve the $${cmd.amount} ${cmd.currency} payment.`,
      ctx.tweetId,
    );
    return;
  }

  // 4. Post public "Pay Now" reply
  const payUrl = intent.paymentUrl ?? `${process.env.AGENTPAY_BASE_URL}/pay/${intent.intentId}`;
  await twitter.v2.reply(
    `@${ctx.senderHandle} 💸 Pay $${cmd.amount} ${cmd.currency} now:\n${payUrl}`,
    ctx.tweetId,
  );
}
