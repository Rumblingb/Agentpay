/**
 * SolanaListenerDO — Cloudflare Durable Object
 *
 * Replaces the Render-hosted Solana listener (src/services/solana-listener.ts).
 *
 * Design:
 *   - Singleton DO (idFromName("main")) — one instance globally
 *   - Uses DO Alarm API to poll every POLL_INTERVAL_MS (default 30s)
 *   - alarm() fetches pending intents from DB, verifies on Solana RPC,
 *     updates status, creates transactions row, fires webhooks
 *   - No @solana/web3.js — uses solanaRpc.ts (raw JSON-RPC fetch)
 *   - No Prisma — uses postgres.js (createDb)
 *
 * Lifecycle:
 *   1. First time: POST /api/_admin/solana-listener/start kicks the DO
 *   2. DO's fetch() sets the first alarm (5s from now)
 *   3. alarm() runs poll(), then schedules next alarm in POLL_INTERVAL_MS
 *   4. Chain continues indefinitely
 *   5. If chain breaks (crash), cron every 5min re-kicks the DO
 *
 * Edge-compatible: all imports work in Cloudflare Workers runtime.
 */

import { createDb } from '../lib/db';
import { verifySolanaPayment } from '../lib/solanaRpc';
import { hmacSign } from '../lib/hmac';
import type { Env } from '../types';

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const SOLANA_RPC_FALLBACK = 'https://api.mainnet-beta.solana.com';
const CONFIRMATION_REQUIRED = 2;

interface PendingIntent {
  intentId: string;
  merchantId: string;
  amountUsdc: number;
  recipientAddress: string;
  txHash: string;
  webhookUrl: string | null;
  agentId: string | null;
}

export class SolanaListenerDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // ── HTTP interface — start/status ────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/start' || request.method === 'POST') {
      const existingAlarm = await this.state.storage.getAlarm();
      if (!existingAlarm) {
        await this.state.storage.setAlarm(Date.now() + 5_000); // first poll in 5s
        return Response.json({ started: true, message: 'Solana listener alarm started — first poll in 5s' });
      }
      return Response.json({ started: false, message: 'Alarm already scheduled', nextAlarm: new Date(existingAlarm).toISOString() });
    }

    if (url.pathname === '/status') {
      const alarm = await this.state.storage.getAlarm();
      return Response.json({
        running: Boolean(alarm),
        nextAlarm: alarm ? new Date(alarm).toISOString() : null,
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  // ── Alarm — called by Cloudflare runtime every POLL_INTERVAL_MS ─────────

  async alarm(): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.poll();
    } catch (err) {
      console.error('[solana-listener] poll error:', err instanceof Error ? err.message : String(err));
    } finally {
      // Always reschedule — even if poll errored
      await this.state.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
      console.info(`[solana-listener] alarm cycle done in ${Date.now() - startedAt}ms, next in ${POLL_INTERVAL_MS / 1000}s`);
    }
  }

  // ── Core poll ────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    const rpcUrl = this.env.SOLANA_RPC_URL ?? SOLANA_RPC_FALLBACK;
    const sql = createDb(this.env);

    try {
      // ── 1. Expire stale pending intents ───────────────────────────────────
      const expired = await sql`
        UPDATE payment_intents
        SET    status     = 'expired',
               updated_at = NOW()
        WHERE  status     = 'pending'
          AND  expires_at < NOW()
        RETURNING id
      `.catch(() => [] as { id: string }[]);

      if (expired.length > 0) {
        console.info(`[solana-listener] expired ${expired.length} stale intent(s)`);
      }

      // ── 2. Fetch pending intents with a submitted tx hash ─────────────────
      const pending = await sql<PendingIntent[]>`
        SELECT
          pi.id                                        AS "intentId",
          pi.merchant_id                               AS "merchantId",
          pi.amount                                    AS "amountUsdc",
          COALESCE(m.wallet_address, 'unknown')        AS "recipientAddress",
          COALESCE(pi.external_ref, pi.metadata->>'tx_hash') AS "txHash",
          m.webhook_url                                AS "webhookUrl",
          pi.agent_id                                  AS "agentId"
        FROM   payment_intents pi
        LEFT JOIN merchants m ON m.id = pi.merchant_id
        WHERE  pi.status = 'pending'
          AND  (pi.external_ref IS NOT NULL OR pi.metadata->>'tx_hash' IS NOT NULL)
          AND  pi.expires_at > NOW()
        ORDER BY pi.created_at ASC
        LIMIT  50
      `.catch(() => [] as PendingIntent[]);

      if (pending.length > 0) {
        console.info(`[solana-listener] checking ${pending.length} pending intent(s)`);
      }

      // ── 3. Process each intent ─────────────────────────────────────────────
      for (const intent of pending) {
        await this.processIntent(intent, rpcUrl, sql).catch((err) =>
          console.error(`[solana-listener] error processing intent ${intent.intentId}:`, err instanceof Error ? err.message : String(err)),
        );
      }
    } finally {
      await sql.end().catch(() => {});
    }
  }

  private async processIntent(
    intent: PendingIntent,
    rpcUrl: string,
    sql: ReturnType<typeof createDb>,
  ): Promise<void> {
    const result = await verifySolanaPayment(
      intent.txHash,
      intent.recipientAddress,
      rpcUrl,
      CONFIRMATION_REQUIRED,
    );

    if (!result.valid) {
      console.debug(`[solana-listener] intent ${intent.intentId}: not valid — ${result.error}`);
      return;
    }

    if (!result.verified) {
      console.debug(`[solana-listener] intent ${intent.intentId}: confirmed but depth ${result.confirmationDepth} < ${CONFIRMATION_REQUIRED}`);
      return;
    }

    // ── Mark intent completed (atomic — only if still pending) ───────────
    const updated = await sql<{ id: string }[]>`
      UPDATE payment_intents
      SET    status     = 'completed',
             updated_at = NOW(),
             metadata   = metadata || ${JSON.stringify({ tx_hash: intent.txHash, confirmedByListener: true })}::jsonb
      WHERE  id     = ${intent.intentId}
        AND  status = 'pending'
      RETURNING id
    `.catch(() => [] as { id: string }[]);

    if (!updated.length) {
      console.debug(`[solana-listener] intent ${intent.intentId}: already processed by concurrent job`);
      return;
    }

    // ── Create transactions row ──────────────────────────────────────────
    await sql`
      INSERT INTO transactions
        (merchant_id, payment_id, amount_usdc, recipient_address,
         payer_address, transaction_hash, status, webhook_status,
         confirmation_depth, metadata)
      VALUES
        (${intent.merchantId},
         ${intent.intentId},
         ${intent.amountUsdc},
         ${intent.recipientAddress},
         ${result.payer ?? null},
         ${intent.txHash},
         'released',
         'not_sent',
         ${result.confirmationDepth},
         ${JSON.stringify({ source: 'solana_listener_do', intentId: intent.intentId })}::jsonb)
      ON CONFLICT (payment_id) DO NOTHING
    `.catch(() => {});

    // ── Update AgentRank (best-effort) ───────────────────────────────────
    if (intent.agentId) {
      const delta = Math.min(Math.round(Number(intent.amountUsdc)), 10);
      await sql`
        INSERT INTO agentrank_scores
          (agent_id, score, payment_reliability, transaction_volume, updated_at)
        VALUES
          (${intent.agentId}::uuid, ${delta}, 100, ${Number(intent.amountUsdc)}, NOW())
        ON CONFLICT (agent_id) DO UPDATE SET
          score               = LEAST(agentrank_scores.score + ${delta}, 1000),
          payment_reliability = LEAST(agentrank_scores.payment_reliability + 1, 100),
          transaction_volume  = agentrank_scores.transaction_volume + ${Number(intent.amountUsdc)},
          updated_at          = NOW()
      `.catch(() => {});
    }

    console.info(`[solana-listener] ✓ intent ${intent.intentId} confirmed — depth ${result.confirmationDepth}, payer ${result.payer}`);

    // ── Fire webhook (best-effort, non-blocking) ─────────────────────────
    if (intent.webhookUrl && this.env.WEBHOOK_SECRET) {
      await this.deliverWebhook(intent, result.payer).catch((err) =>
        console.warn(`[solana-listener] webhook failed for ${intent.intentId}:`, err instanceof Error ? err.message : String(err)),
      );
    }
  }

  private async deliverWebhook(
    intent: PendingIntent,
    payerAddress: string | null,
  ): Promise<void> {
    if (!intent.webhookUrl) return;

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = JSON.stringify({
      type: 'payment_verified',
      intentId: intent.intentId,
      merchantId: intent.merchantId,
      agentId: intent.agentId,
      amount: Number(intent.amountUsdc),
      currency: 'USDC',
      recipientAddress: intent.recipientAddress,
      payerAddress,
      transactionHash: intent.txHash,
      verifiedAt: new Date().toISOString(),
    });

    const signature = await hmacSign(`${timestamp}.${payload}`, this.env.WEBHOOK_SECRET);

    await fetch(intent.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AgentPay-Signature': signature,
        'X-AgentPay-Timestamp': timestamp,
        'X-AgentPay-Event': 'payment_verified',
        'User-Agent': 'AgentPay-Listener/2.0',
      },
      body: payload,
      signal: AbortSignal.timeout(8_000),
    });
  }
}
