/**
 * index.ts – AgentPay Twitter Micropayments Bot
 *
 * Responsibilities:
 *   • Listen to Twitter v2 filtered stream for @AgentPay mentions.
 *   • Process tip / send / pay / #paywall commands.
 *   • Host a small Express server to receive:
 *       POST /webhook/solana  – Solana on-chain payment confirmations
 *       GET  /health          – liveness probe
 */

import 'dotenv/config';
import crypto from 'crypto';
import express, { Request, Response } from 'express';
import { createReadOnlyClient, createTwitterClient } from '../config/twitterClient.js';
import { AgentPayClient } from './services/agentpayClient.js';
import { processIncomingTweet } from './handlers/incomingTweets.js';
import { handleVerification } from './handlers/verification.js';

const PORT = parseInt(process.env.PORT ?? '4000', 10);
const BOT_HANDLE = process.env.TWITTER_BOT_HANDLE ?? 'AgentPay';
const DEFAULT_MERCHANT_ID = process.env.AGENTPAY_MERCHANT_ID ?? '';
const BOT_AGENT_ID = process.env.AGENTPAY_BOT_AGENT_ID ?? '';
const SOLANA_WEBHOOK_SECRET = process.env.SOLANA_WEBHOOK_SECRET ?? '';

// ── Clients ────────────────────────────────────────────────────────────────
const twitterRw = createTwitterClient();
const twitterRo = createReadOnlyClient();

const agentpay = new AgentPayClient({
  baseUrl: process.env.AGENTPAY_BASE_URL ?? 'http://localhost:3001',
  apiKey: process.env.AGENTPAY_API_KEY ?? '',
  dailyLimitUsd: parseFloat(process.env.DAILY_LIMIT_USD ?? '20'),
});

// ── Express webhook server ─────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', bot: `@${BOT_HANDLE}` });
});

/**
 * POST /webhook/solana
 * Receives on-chain payment confirmation events from the AgentPay backend.
 * Expected payload: { txHash, amountUsd, currency, senderHandle, senderAgentId, receiverHandle, replyToTweetId? }
 */
app.post('/webhook/solana', async (req: Request, res: Response) => {
  // Constant-time signature validation to prevent timing attacks
  const sig = req.headers['x-agentpay-signature'];
  if (SOLANA_WEBHOOK_SECRET) {
    const expected = `sha256=${SOLANA_WEBHOOK_SECRET}`;
    const sigStr = typeof sig === 'string' ? sig : '';
    const expectedBuf = Buffer.from(expected);
    const sigBuf = Buffer.alloc(expectedBuf.length);
    sigBuf.write(sigStr.slice(0, expectedBuf.length));
    const isValid =
      sigStr.length === expected.length &&
      crypto.timingSafeEqual(expectedBuf, sigBuf);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  }

  const {
    txHash,
    amountUsd,
    currency = 'USDC',
    senderHandle,
    senderAgentId,
    receiverHandle,
    replyToTweetId,
  } = req.body as Record<string, string>;

  if (!txHash || !senderHandle || !receiverHandle) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    await handleVerification(twitterRw, agentpay, {
      txHash,
      amountUsd: parseFloat(amountUsd ?? '0'),
      currency,
      senderHandle,
      senderAgentId,
      receiverHandle,
      replyToTweetId,
    });
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`[AgentPay Twitter Bot] Webhook server listening on :${PORT}`);
});

// ── Twitter Filtered Stream ────────────────────────────────────────────────

async function startStream(): Promise<void> {
  // Ensure the filter rule for @<BOT_HANDLE> mentions is set
  const rules = await twitterRo.v2.streamRules();
  const alreadySet = (rules.data ?? []).some((r) =>
    r.value.includes(`@${BOT_HANDLE}`),
  );

  if (!alreadySet) {
    await twitterRo.v2.updateStreamRules({
      add: [{ value: `@${BOT_HANDLE}`, tag: 'agentpay-mentions' }],
    });
    console.log(`[Stream] Filter rule added for @${BOT_HANDLE}`);
  }

  const stream = await twitterRo.v2.searchStream({
    'tweet.fields': ['author_id', 'text', 'created_at'],
    'user.fields': ['username'],
    expansions: ['author_id'],
  });

  stream.autoReconnect = true;

  stream.on('data', async (tweet) => {
    const authorId: string = tweet.data.author_id ?? '';
    const authorHandle: string =
      tweet.includes?.users?.find((u: { id: string }) => u.id === authorId)?.username ?? 'unknown';

    await processIncomingTweet(
      twitterRw,
      agentpay,
      {
        id: tweet.data.id,
        text: tweet.data.text,
        authorId,
        authorHandle,
      },
      DEFAULT_MERCHANT_ID,
      BOT_AGENT_ID,
    );
  });

  stream.on('error', (err: Error) => {
    console.error('[Stream] Error:', err.message);
  });

  console.log('[Stream] Listening for mentions…');
}

startStream().catch((err: Error) => {
  console.error('[Stream] Fatal error:', err.message);
  process.exit(1);
});
