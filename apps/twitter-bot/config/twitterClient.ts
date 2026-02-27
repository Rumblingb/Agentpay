/**
 * twitterClient.ts
 *
 * Initialises and exports the Twitter API v2 client used throughout the bot.
 * Credentials are read from environment variables so that nothing sensitive
 * is hard-coded in source.
 */

import { TwitterApi } from 'twitter-api-v2';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Create a Twitter API v2 client with OAuth 1.0a User Context credentials.
 * These are required for read/write access (posting tweets, sending DMs).
 */
export function createTwitterClient(): TwitterApi {
  return new TwitterApi({
    appKey:    requireEnv('TWITTER_API_KEY'),
    appSecret: requireEnv('TWITTER_API_SECRET'),
    accessToken:  requireEnv('TWITTER_ACCESS_TOKEN'),
    accessSecret: requireEnv('TWITTER_ACCESS_SECRET'),
  });
}

/**
 * Create a read-only Twitter API v2 client using a Bearer Token.
 * Used for streaming mentions and searching tweets.
 */
export function createReadOnlyClient(): TwitterApi {
  return new TwitterApi(requireEnv('TWITTER_BEARER_TOKEN'));
}
