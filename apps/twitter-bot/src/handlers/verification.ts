/**
 * verification.ts
 *
 * After a Solana on-chain payment is confirmed the webhook handler calls
 * handleVerification() which:
 *   1. Retrieves the signed certificate from AgentPay /api/verify/:txHash.
 *   2. Looks up the sender's reputation score.
 *   3. Tweets a "Payment Verified" public message with amount, txHash,
 *      sender, receiver and the signed certificate summary.
 */

import { TwitterApi } from 'twitter-api-v2';
import type { AgentPayClient } from '../services/agentpayClient.js';

/** Shape of a signed AgentPay payment certificate. */
interface Certificate {
  id?: string;
  signature?: string;
  [key: string]: unknown;
}

export interface VerificationContext {
  txHash: string;
  amountUsd: number;
  currency: string;
  senderHandle: string;
  senderAgentId: string;
  receiverHandle: string;
  /** Tweet ID to reply to (optional — bot can also just post a new tweet). */
  replyToTweetId?: string;
}

/**
 * Tweet a "Payment Verified" announcement after on-chain confirmation.
 */
export async function handleVerification(
  twitter: TwitterApi,
  agentpay: AgentPayClient,
  ctx: VerificationContext,
): Promise<void> {
  // 1. Fetch signed certificate
  let certSummary = '(certificate unavailable)';
  try {
    const result = await agentpay.getVerification(ctx.txHash);
    if (result.verified && result.certificate) {
      const cert = result.certificate as Certificate;
      certSummary = `cert_id:${cert.id ?? 'n/a'} sig:${String(cert.signature ?? '').slice(0, 16)}…`;
    }
  } catch {
    // Non-fatal – still post the verification tweet
  }

  // 2. Fetch sender reputation
  const rep = await agentpay.getReputation(ctx.senderAgentId);
  const repLine = rep
    ? `\n📊 @${ctx.senderHandle} reputation score: ${rep.trustScore}`
    : '';

  // 3. Post verified tweet
  const tweetText = [
    `✅ Payment Verified`,
    `💸 $${ctx.amountUsd} ${ctx.currency}`,
    `📤 @${ctx.senderHandle} → 📥 @${ctx.receiverHandle}`,
    `🔗 txHash: ${ctx.txHash.slice(0, 20)}…`,
    `📜 ${certSummary}`,
    repLine,
  ]
    .filter(Boolean)
    .join('\n');

  if (ctx.replyToTweetId) {
    await twitter.v2.reply(tweetText, ctx.replyToTweetId);
  } else {
    await twitter.v2.tweet(tweetText);
  }
}
