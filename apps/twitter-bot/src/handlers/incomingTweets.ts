/**
 * incomingTweets.ts
 *
 * Processes a single incoming tweet mention.
 * Delegates to the appropriate handler based on parsed command type.
 *
 * Also handles the wallet-linking DM flow:
 *   "Connect Wallet" → generates a delegated spending key, stores only
 *   the public key + AgentPay identity (NEVER the private key).
 */

import { TwitterApi } from 'twitter-api-v2';
import type { AgentPayClient } from '../services/agentpayClient.js';
import { parseTweet } from '../services/tweetParser.js';
import { handleTip } from './tipping.js';
import { handlePaywall } from './payLinks.js';

export interface IncomingTweet {
  id: string;
  text: string;
  authorId: string;
  authorHandle: string;
}

/**
 * Mapping from Twitter user ID → AgentPay-linked wallet info.
 * Stored in memory – replace with a persistent store (Redis/DB) in production.
 * WARNING: This Map is reset on every process restart. Do NOT deploy to
 * production without replacing with a persistent store.
 * IMPORTANT: private keys are NEVER stored here.
 */
export interface LinkedWallet {
  twitterUserId: string;
  agentpayIdentity: string;
  publicKey: string;
}

const linkedWallets = new Map<string, LinkedWallet>();

/** Register a linked wallet for a Twitter user. */
export function linkWallet(wallet: LinkedWallet): void {
  linkedWallets.set(wallet.twitterUserId, wallet);
}

/** Look up a linked wallet. Returns undefined if not linked. */
export function getLinkedWallet(twitterUserId: string): LinkedWallet | undefined {
  return linkedWallets.get(twitterUserId);
}

/**
 * Main incoming tweet processor.
 * Called by the streaming/webhook listener for every mention.
 */
export async function processIncomingTweet(
  twitter: TwitterApi,
  agentpay: AgentPayClient,
  tweet: IncomingTweet,
  /** AgentPay merchant ID for the target recipient when cmd.recipient is null. */
  defaultMerchantId: string,
  /** AgentPay agent ID representing the bot itself. */
  botAgentId: string,
): Promise<void> {
  const cmd = parseTweet(tweet.text);
  if (!cmd) return;

  if (cmd.type === 'paywall') {
    await handlePaywall(twitter, agentpay, cmd, {
      tweetId: tweet.id,
      authorUserId: tweet.authorId,
      authorHandle: tweet.authorHandle,
      merchantId: defaultMerchantId,
      botAgentId,
    });
    return;
  }

  // tip / send / pay
  await handleTip(twitter, agentpay, cmd, {
    tweetId: tweet.id,
    senderUserId: tweet.authorId,
    senderHandle: tweet.authorHandle,
    merchantId: defaultMerchantId,
    agentId: tweet.authorId,
  });
}
