/**
 * Verification handler for the AgentPay Twitter bot.
 * Handles !verify commands to confirm Solana transaction hashes.
 */

import { TwitterApi, TweetV2 } from 'twitter-api-v2';
import { parseMention } from '../utils/tweetParser';
import { AgentPayClient } from '../clients/agentpayClient';

export interface VerificationHandlerConfig {
  twitterClient: TwitterApi;
  agentPayClient: AgentPayClient;
  botHandle: string;
}

export interface HandleVerifyResult {
  handled: boolean;
  tweetId?: string;
  valid?: boolean;
  error?: string;
}

/**
 * Handles a tweet that mentions the bot with a !verify command.
 * Verifies the transaction hash on-chain and replies with the result.
 */
export async function handleVerifyMention(
  tweet: TweetV2,
  authorUsername: string,
  config: VerificationHandlerConfig
): Promise<HandleVerifyResult> {
  const text = tweet.text || '';
  const parsed = parseMention(text);

  if (parsed.type !== 'verify' || !parsed.txHash) {
    return { handled: false };
  }

  const { txHash } = parsed;

  try {
    const result = await config.agentPayClient.verifyTip(txHash);

    let replyText: string;
    if (result.valid) {
      const shortHash =
        txHash.length > 16
          ? `${txHash.slice(0, 8)}...${txHash.slice(-8)}`
          : txHash;
      replyText =
        `@${authorUsername} ✅ Payment verified!\n` +
        `Transaction: ${shortHash}\n` +
        (result.transactionId ? `Tip ID: ${result.transactionId}` : '');
    } else {
      replyText =
        `@${authorUsername} ❌ Payment could not be verified.\n` +
        (result.error ? `Reason: ${result.error}` : 'Transaction not found or invalid.');
    }

    const reply = await config.twitterClient.v2.reply(replyText, tweet.id);
    return { handled: true, tweetId: reply.data.id, valid: result.valid };
  } catch (err: any) {
    return { handled: true, error: err.message };
  }
}
