/**
 * Moltbook Service
 * Server-side business logic for the Moltbook bot micro-economy.
 *
 * Handles: bot wallet dashboard, spending policy enforcement,
 * marketplace, subscriptions, reputation engine, and admin analytics.
 */

import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Keypair } from '@solana/web3.js';
import { query } from '../db/index.js';
import { logger } from '../logger.js';
import { encryptKeypair, decryptKeypair } from '../utils/walletEncryption.js';

const SALT_ROUNDS = 12;

// ── Default spending policy ────────────────────────────────────────────────

const DEFAULT_SPENDING_POLICY = {
  daily_spending_limit: 10.00,
  per_tx_limit: 2.00,
  auto_approve_under: 0.50,
  daily_auto_approve_cap: 5.00,
} as const;

// ── Types ──────────────────────────────────────────────────────────────────

export interface SpendingPolicy {
  dailySpendingLimit: number;
  perTxLimit: number;
  autoApproveUnder: number;
  dailyAutoApproveCap: number;
  requirePinAbove: number | null;
  alertWebhookUrl: string | null;
}

export interface SpendingPolicyCheckResult {
  approved: boolean;
  autoApproved: boolean;
  requiresPin: boolean;
  reason?: string;
  remainingDaily?: number;
  remainingAutoApproveDaily?: number;
}

export interface ServiceSearchParams {
  q?: string;
  category?: string;
  tags?: string[];
  minPrice?: number;
  maxPrice?: number;
  minReputation?: number;
  sortBy?: 'revenue' | 'rating' | 'reputation' | 'uses';
  limit?: number;
  offset?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Resolve a bot row by UUID or platform_bot_id. */
async function resolveBotId(botId: string): Promise<string | null> {
  const result = await query(
    `SELECT id FROM bots WHERE id = $1 OR platform_bot_id = $1 LIMIT 1`,
    [botId]
  );
  return result.rows[0]?.id ?? null;
}

/** Fire an alert webhook for a spending policy violation (fire-and-forget). */
async function fireSpendAlert(
  webhookUrl: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'spend_violation', ...payload }),
    });
  } catch (err) {
    logger.warn('Failed to fire spend alert webhook', { webhookUrl, err });
  }
}

// ── Bot Registration ───────────────────────────────────────────────────────

/**
 * Encrypts a Solana keypair's secret key.
 * Falls back to empty string if AGENTPAY_SIGNING_SECRET is not configured
 * (e.g. local development without .env) so registration doesn't hard-fail,
 * but logs a warning so operators know the keypair is unprotected.
 */
function encryptKeypairSafe(keypair: Keypair): string {
  try {
    return encryptKeypair(keypair.secretKey);
  } catch (err: any) {
    const isDevEnv = process.env.NODE_ENV !== 'production';
    if (isDevEnv) {
      logger.warn('Wallet keypair encryption skipped — AGENTPAY_SIGNING_SECRET not set', {
        error: err?.message,
        env: process.env.NODE_ENV,
      });
    } else {
      logger.error(
        'CRITICAL: Wallet keypair encryption failed in production — AGENTPAY_SIGNING_SECRET missing. ' +
        'Bot wallet will be unrecoverable.',
        { error: err?.message, env: process.env.NODE_ENV },
      );
    }
    return '';
  }
}

export interface BotRegistrationResult {
  botId: string;
  platformBotId: string;
  handle: string;
  walletAddress: string;
  spendingPolicy: {
    dailyMax: number;
    perTxMax: number;
    autoApproveUnder: number;
  };
}

/**
 * Registers a new bot with smart defaults.
 * Only `handle` is required; all other fields are optional or auto-generated.
 */
export async function registerBot(
  handle: string,
  options?: {
    display_name?: string;
    bio?: string;
    created_by?: string;
    primary_function?: string;
    platform_bot_id?: string;
  }
): Promise<BotRegistrationResult | null> {
  const wallet = Keypair.generate();
  const walletAddress = wallet.publicKey.toString();
  const platformBotId = options?.platform_bot_id ?? randomUUID();
  const displayName = options?.display_name ?? handle;

  try {
    const result = await query(
      `INSERT INTO bots
         (platform_bot_id, handle, display_name, bio, created_by, primary_function,
          wallet_address, wallet_keypair_encrypted,
          daily_spending_limit, per_tx_limit, auto_approve_under, daily_auto_approve_cap)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, platform_bot_id, handle, wallet_address`,
      [
        platformBotId,
        handle,
        displayName,
        options?.bio ?? null,
        options?.created_by ?? null,
        options?.primary_function ?? null,
        walletAddress,
        // AES-256-GCM encrypted secret key, keyed off AGENTPAY_SIGNING_SECRET.
        // Empty string is stored as a fallback when the secret is not configured
        // (e.g. local dev without .env) — wallet recovery will not be possible
        // in that case, but no exception is raised so bot registration still works.
        encryptKeypairSafe(wallet),
        DEFAULT_SPENDING_POLICY.daily_spending_limit,
        DEFAULT_SPENDING_POLICY.per_tx_limit,
        DEFAULT_SPENDING_POLICY.auto_approve_under,
        DEFAULT_SPENDING_POLICY.daily_auto_approve_cap,
      ]
    );

    const row = result.rows[0];
    if (!row) return null;

    logger.info('Bot registered', { botId: row.id, handle, walletAddress });

    return {
      botId: row.id,
      platformBotId: row.platform_bot_id,
      handle: row.handle,
      walletAddress: row.wallet_address,
      spendingPolicy: {
        dailyMax: DEFAULT_SPENDING_POLICY.daily_spending_limit,
        perTxMax: DEFAULT_SPENDING_POLICY.per_tx_limit,
        autoApproveUnder: DEFAULT_SPENDING_POLICY.auto_approve_under,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : (err as any)?.message ?? String(err);
    if (message.includes('duplicate key') || message.includes('unique')) {
      logger.warn('Bot registration failed: duplicate handle or platform_bot_id', { handle });
      return null;
    }
    throw err;
  }
}

// ── Bot Wallet Dashboard ───────────────────────────────────────────────────

/**
 * Returns a comprehensive financial overview for a bot.
 * Includes today's spend/earnings, auto-approve remaining, tip history,
 * service income, active subscriptions, reputation, and last 10 rep events.
 */
export async function getBotOverview(botId: string): Promise<Record<string, unknown> | null> {
  const internalId = await resolveBotId(botId);
  if (!internalId) return null;

  const [botRow, dailySpend, dailyEarnings, serviceIncome, subCount, repEvents] =
    await Promise.all([
      query(
        `SELECT id, platform_bot_id, handle, display_name, balance_usdc,
                total_earned, total_spent, total_tips_received,
                reputation_score, daily_spending_limit, per_tx_limit,
                auto_approve_under, daily_auto_approve_cap,
                tips_received_count, total_transactions, successful_transactions,
                disputed_transactions, status
         FROM bots WHERE id = $1`,
        [internalId]
      ),
      // Today's spending (outgoing)
      query(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM bot_transactions
         WHERE from_bot_id = $1 AND status = 'completed'
           AND created_at >= CURRENT_DATE`,
        [internalId]
      ),
      // Today's earnings (incoming)
      query(
        `SELECT COALESCE(SUM(recipient_receives), 0) as total
         FROM bot_transactions
         WHERE to_bot_id = $1 AND status = 'completed'
           AND created_at >= CURRENT_DATE`,
        [internalId]
      ),
      // Service income (all-time revenue from services)
      query(
        `SELECT COALESCE(SUM(s.total_revenue), 0) as total
         FROM services s WHERE s.provider_bot_id = $1`,
        [internalId]
      ),
      // Active subscription count
      query(
        `SELECT COUNT(*) as count FROM bot_subscriptions
         WHERE subscriber_bot_id = $1 AND status = 'active'`,
        [internalId]
      ),
      // Last 10 reputation events
      query(
        `SELECT event_type, impact, description, created_at
         FROM reputation_events WHERE bot_id = $1
         ORDER BY created_at DESC LIMIT 10`,
        [internalId]
      ),
    ]);

  if (!botRow.rows[0]) return null;

  const bot = botRow.rows[0];
  const dailyAutoApproveCap = Number(bot.daily_auto_approve_cap ?? 5);
  const todaySpend = Number(dailySpend.rows[0]?.total ?? 0);
  const todayEarnings = Number(dailyEarnings.rows[0]?.total ?? 0);

  // Remaining auto-approve limit: daily_auto_approve_cap minus auto-approved spend today
  const autoApprovedTodayRow = await query(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM bot_transactions
     WHERE from_bot_id = $1 AND auto_approved = true AND status = 'completed'
       AND created_at >= CURRENT_DATE`,
    [internalId]
  );
  const autoApprovedToday = Number(autoApprovedTodayRow.rows[0]?.total ?? 0);

  return {
    botId: bot.id,
    platformBotId: bot.platform_bot_id,
    handle: bot.handle,
    displayName: bot.display_name,
    status: bot.status,
    balanceUsdc: Number(bot.balance_usdc),
    dailySpend: todaySpend,
    dailyEarnings: todayEarnings,
    remainingAutoApproveLimit: Math.max(0, dailyAutoApproveCap - autoApprovedToday),
    tipHistory: {
      totalTipsReceived: Number(bot.total_tips_received),
      tipsReceivedCount: Number(bot.tips_received_count),
    },
    serviceIncome: Number(serviceIncome.rows[0]?.total ?? 0),
    activeSubscriptions: Number(subCount.rows[0]?.count ?? 0),
    reputation: {
      score: Number(bot.reputation_score),
      totalTransactions: Number(bot.total_transactions),
      successfulTransactions: Number(bot.successful_transactions),
      disputedTransactions: Number(bot.disputed_transactions),
      recentEvents: repEvents.rows,
    },
  };
}

/**
 * Returns paginated transaction history for a bot (incoming + outgoing).
 */
export async function getBotHistory(
  botId: string,
  limit = 50,
  offset = 0
): Promise<{ transactions: unknown[]; total: number }> {
  const internalId = await resolveBotId(botId);
  if (!internalId) return { transactions: [], total: 0 };

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT bt.*, fb.handle as from_handle, tb.handle as to_handle
       FROM bot_transactions bt
       LEFT JOIN bots fb ON bt.from_bot_id = fb.id
       LEFT JOIN bots tb ON bt.to_bot_id = tb.id
       WHERE bt.from_bot_id = $1 OR bt.to_bot_id = $1
       ORDER BY bt.created_at DESC
       LIMIT $2 OFFSET $3`,
      [internalId, limit, offset]
    ),
    query(
      `SELECT COUNT(*) as count FROM bot_transactions
       WHERE from_bot_id = $1 OR to_bot_id = $1`,
      [internalId]
    ),
  ]);

  return {
    transactions: rows.rows,
    total: Number(countRow.rows[0]?.count ?? 0),
  };
}

/**
 * Returns services provided by a bot.
 */
export async function getBotServices(botId: string): Promise<unknown[]> {
  const internalId = await resolveBotId(botId);
  if (!internalId) return [];

  const result = await query(
    `SELECT id, name, description, category, price, pricing_model,
            api_endpoint, api_method, avg_response_time_ms, success_rate,
            total_uses, total_revenue, rating, review_count, status, tags, created_at
     FROM services WHERE provider_bot_id = $1 ORDER BY created_at DESC`,
    [internalId]
  );
  return result.rows;
}

/**
 * Returns subscriptions for a bot (as subscriber).
 */
export async function getBotSubscriptions(botId: string): Promise<unknown[]> {
  const internalId = await resolveBotId(botId);
  if (!internalId) return [];

  const result = await query(
    `SELECT bs.*, s.name as service_name, pb.handle as provider_handle
     FROM bot_subscriptions bs
     LEFT JOIN services s ON bs.service_id = s.id
     LEFT JOIN bots pb ON bs.provider_bot_id = pb.id
     WHERE bs.subscriber_bot_id = $1
     ORDER BY bs.created_at DESC`,
    [internalId]
  );
  return result.rows;
}

// ── Spending Policy ────────────────────────────────────────────────────────

/**
 * Returns a bot's spending policy.
 */
export async function getSpendingPolicy(botId: string): Promise<SpendingPolicy | null> {
  const internalId = await resolveBotId(botId);
  if (!internalId) return null;

  const result = await query(
    `SELECT daily_spending_limit, per_tx_limit, auto_approve_under,
            daily_auto_approve_cap, require_pin_above, alert_webhook_url
     FROM bots WHERE id = $1`,
    [internalId]
  );

  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    dailySpendingLimit: Number(row.daily_spending_limit),
    perTxLimit: Number(row.per_tx_limit),
    autoApproveUnder: Number(row.auto_approve_under),
    dailyAutoApproveCap: Number(row.daily_auto_approve_cap ?? 5),
    requirePinAbove: row.require_pin_above != null ? Number(row.require_pin_above) : null,
    alertWebhookUrl: row.alert_webhook_url ?? null,
  };
}

/**
 * Updates a bot's spending policy.
 */
export async function updateSpendingPolicy(
  botId: string,
  policy: Partial<SpendingPolicy & { pin?: string }>
): Promise<SpendingPolicy | null> {
  const internalId = await resolveBotId(botId);
  if (!internalId) return null;

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  let idx = 1;

  if (policy.dailySpendingLimit !== undefined) {
    updates.push(`daily_spending_limit = $${idx++}`);
    values.push(policy.dailySpendingLimit);
  }
  if (policy.perTxLimit !== undefined) {
    updates.push(`per_tx_limit = $${idx++}`);
    values.push(policy.perTxLimit);
  }
  if (policy.autoApproveUnder !== undefined) {
    updates.push(`auto_approve_under = $${idx++}`);
    values.push(policy.autoApproveUnder);
  }
  if (policy.dailyAutoApproveCap !== undefined) {
    updates.push(`daily_auto_approve_cap = $${idx++}`);
    values.push(policy.dailyAutoApproveCap);
  }
  if (policy.requirePinAbove !== undefined) {
    updates.push(`require_pin_above = $${idx++}`);
    values.push(policy.requirePinAbove);
  }
  if (policy.alertWebhookUrl !== undefined) {
    updates.push(`alert_webhook_url = $${idx++}`);
    values.push(policy.alertWebhookUrl);
  }
  if (policy.pin !== undefined) {
    updates.push(`pin_hash = $${idx++}`);
    values.push(await bcrypt.hash(policy.pin, SALT_ROUNDS));
  }

  if (updates.length === 0) return getSpendingPolicy(botId);

  updates.push(`updated_at = NOW()`);
  values.push(internalId);

  await query(
    `UPDATE bots SET ${updates.join(', ')} WHERE id = $${idx}`,
    values
  );

  return getSpendingPolicy(botId);
}

/**
 * Returns total spending for a bot today.
 */
export async function getTodaySpending(botId: string): Promise<number> {
  const result = await query(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM bot_transactions
     WHERE from_bot_id = $1 AND status = 'completed' AND created_at >= CURRENT_DATE`,
    [botId]
  );
  return Number(result.rows[0]?.total ?? 0);
}

/**
 * Checks whether a bot is permitted to spend `amount` under its spending policy.
 * Enforces: daily max, per-tx max, daily auto-approve cap, PIN requirement.
 * Fires an alert webhook on policy violation if configured.
 */
export async function checkSpendingPolicy(
  botId: string,
  amount: number,
  pin?: string
): Promise<SpendingPolicyCheckResult> {
  const internalId = await resolveBotId(botId);
  if (!internalId) {
    return { approved: false, autoApproved: false, requiresPin: false, reason: 'Bot not found' };
  }

  const policyResult = await query(
    `SELECT daily_spending_limit, per_tx_limit, auto_approve_under,
            daily_auto_approve_cap, require_pin_above, alert_webhook_url, pin_hash
     FROM bots WHERE id = $1`,
    [internalId]
  );

  if (!policyResult.rows[0]) {
    return { approved: false, autoApproved: false, requiresPin: false, reason: 'Bot not found' };
  }

  const row = policyResult.rows[0];
  const dailyMax = Number(row.daily_spending_limit);
  const perTxMax = Number(row.per_tx_limit);
  const autoApproveUnder = Number(row.auto_approve_under);
  const dailyAutoApproveCap = Number(row.daily_auto_approve_cap ?? 5);
  const requirePinAbove: number | null = row.require_pin_above != null ? Number(row.require_pin_above) : null;
  const alertWebhookUrl: string | null = row.alert_webhook_url ?? null;
  const pinHash: string | null = row.pin_hash ?? null;

  const [todaySpendRow, todayAutoApproveRow] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM bot_transactions
       WHERE from_bot_id = $1 AND status = 'completed' AND created_at >= CURRENT_DATE`,
      [internalId]
    ),
    query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM bot_transactions
       WHERE from_bot_id = $1 AND auto_approved = true AND status = 'completed'
         AND created_at >= CURRENT_DATE`,
      [internalId]
    ),
  ]);

  const todaySpent = Number(todaySpendRow.rows[0]?.total ?? 0);
  const todayAutoApproved = Number(todayAutoApproveRow.rows[0]?.total ?? 0);

  // 1. Daily max spend cap
  if (todaySpent + amount > dailyMax) {
    const violation = {
      botId: internalId,
      amount,
      reason: 'Daily spending limit exceeded',
      dailyMax,
      todaySpent,
    };
    if (alertWebhookUrl) void fireSpendAlert(alertWebhookUrl, violation);
    return {
      approved: false,
      autoApproved: false,
      requiresPin: false,
      reason: 'Daily spending limit exceeded',
      remainingDaily: Math.max(0, dailyMax - todaySpent),
    };
  }

  // 2. Per-transaction max
  if (amount > perTxMax) {
    const violation = { botId: internalId, amount, reason: 'Transaction limit exceeded', perTxMax };
    if (alertWebhookUrl) void fireSpendAlert(alertWebhookUrl, violation);
    return {
      approved: false,
      autoApproved: false,
      requiresPin: false,
      reason: 'Transaction limit exceeded',
      remainingDaily: Math.max(0, dailyMax - todaySpent),
    };
  }

  // 3. PIN requirement
  const requiresPin = requirePinAbove !== null && amount >= requirePinAbove;
  if (requiresPin) {
    if (!pin) {
      return {
        approved: false,
        autoApproved: false,
        requiresPin: true,
        reason: `PIN required for transactions above ${requirePinAbove}`,
        remainingDaily: Math.max(0, dailyMax - todaySpent),
      };
    }
    if (!pinHash) {
      return {
        approved: false,
        autoApproved: false,
        requiresPin: true,
        reason: 'PIN not configured for this bot',
      };
    }
    const pinValid = await bcrypt.compare(pin, pinHash);
    if (!pinValid) {
      return {
        approved: false,
        autoApproved: false,
        requiresPin: true,
        reason: 'Invalid PIN',
      };
    }
  }

  // 4. Auto-approve decision
  const wouldBeAutoApproved = amount < autoApproveUnder;
  if (wouldBeAutoApproved && todayAutoApproved + amount > dailyAutoApproveCap) {
    // Exceeds daily auto-approve cap — allowed but requires manual approval
    return {
      approved: true,
      autoApproved: false,
      requiresPin: requiresPin,
      reason: 'Daily auto-approve cap reached; manual approval required',
      remainingDaily: Math.max(0, dailyMax - todaySpent),
      remainingAutoApproveDaily: 0,
    };
  }

  return {
    approved: true,
    autoApproved: wouldBeAutoApproved,
    requiresPin: requiresPin,
    remainingDaily: Math.max(0, dailyMax - todaySpent - amount),
    remainingAutoApproveDaily: Math.max(0, dailyAutoApproveCap - todayAutoApproved - (wouldBeAutoApproved ? amount : 0)),
  };
}

// ── Marketplace ────────────────────────────────────────────────────────────

/**
 * Returns a paginated list of active marketplace services.
 */
export async function listServices(
  limit = 20,
  offset = 0,
  category?: string,
  sortBy: 'uses' | 'rating' | 'revenue' = 'uses'
): Promise<{ services: unknown[]; total: number }> {
  const sortColumn: Record<string, string> = {
    uses: 's.total_uses',
    rating: 's.rating',
    revenue: 's.total_revenue',
  };
  const orderExpr = sortColumn[sortBy] ?? 's.total_uses';

  const params: (string | number)[] = [];
  let whereClause = `WHERE s.status = 'active'`;

  if (category) {
    params.push(category);
    whereClause += ` AND s.category = $${params.length}`;
  }

  const countParams = [...params];
  params.push(limit);
  params.push(offset);

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT s.id, s.name, s.description, s.category, s.price, s.pricing_model,
              s.avg_response_time_ms, s.success_rate, s.total_uses, s.total_revenue,
              s.rating, s.review_count, s.tags, s.created_at,
              b.handle as provider_handle, b.reputation_score as provider_reputation
       FROM services s
       JOIN bots b ON s.provider_bot_id = b.id
       ${whereClause}
       ORDER BY ${orderExpr} DESC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    query(
      `SELECT COUNT(*) as count FROM services s
       JOIN bots b ON s.provider_bot_id = b.id ${whereClause}`,
      countParams
    ),
  ]);

  return { services: rows.rows, total: Number(countRow.rows[0]?.count ?? 0) };
}

/**
 * Returns a single marketplace service by ID.
 */
export async function getService(serviceId: string): Promise<unknown | null> {
  const result = await query(
    `SELECT s.*, b.handle as provider_handle, b.reputation_score as provider_reputation,
            b.platform_bot_id as provider_bot_platform_id
     FROM services s
     JOIN bots b ON s.provider_bot_id = b.id
     WHERE s.id = $1`,
    [serviceId]
  );
  return result.rows[0] ?? null;
}

/**
 * Searches marketplace services by text, category, tags, price range, and reputation.
 */
export async function searchServices(params: ServiceSearchParams): Promise<{ services: unknown[]; total: number }> {
  const {
    q,
    category,
    tags,
    minPrice,
    maxPrice,
    minReputation,
    sortBy = 'uses',
    limit = 20,
    offset = 0,
  } = params;

  const sortColumn: Record<string, string> = {
    uses: 's.total_uses',
    rating: 's.rating',
    revenue: 's.total_revenue',
    reputation: 'b.reputation_score',
  };
  const orderExpr = sortColumn[sortBy] ?? 's.total_uses';

  const conditions: string[] = [`s.status = 'active'`];
  const queryParams: (string | number | string[])[] = [];
  let idx = 1;

  if (q) {
    queryParams.push(`%${q}%`);
    conditions.push(`(s.name ILIKE $${idx} OR s.description ILIKE $${idx})`);
    idx++;
  }
  if (category) {
    queryParams.push(category);
    conditions.push(`s.category = $${idx++}`);
  }
  if (tags && tags.length > 0) {
    queryParams.push(tags);
    conditions.push(`s.tags && $${idx++}::text[]`);
  }
  if (minPrice !== undefined) {
    queryParams.push(minPrice);
    conditions.push(`s.price >= $${idx++}`);
  }
  if (maxPrice !== undefined) {
    queryParams.push(maxPrice);
    conditions.push(`s.price <= $${idx++}`);
  }
  if (minReputation !== undefined) {
    queryParams.push(minReputation);
    conditions.push(`b.reputation_score >= $${idx++}`);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const countParams = [...queryParams];

  queryParams.push(limit);
  queryParams.push(offset);

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT s.id, s.name, s.description, s.category, s.price, s.pricing_model,
              s.avg_response_time_ms, s.success_rate, s.total_uses, s.total_revenue,
              s.rating, s.review_count, s.tags, s.created_at,
              b.handle as provider_handle, b.reputation_score as provider_reputation
       FROM services s
       JOIN bots b ON s.provider_bot_id = b.id
       ${whereClause}
       ORDER BY ${orderExpr} DESC NULLS LAST
       LIMIT $${idx} OFFSET $${idx + 1}`,
      queryParams
    ),
    query(
      `SELECT COUNT(*) as count FROM services s
       JOIN bots b ON s.provider_bot_id = b.id ${whereClause}`,
      countParams
    ),
  ]);

  return { services: rows.rows, total: Number(countRow.rows[0]?.count ?? 0) };
}

// ── Subscriptions ──────────────────────────────────────────────────────────

/**
 * Returns all subscriptions for a bot (as subscriber or provider).
 */
export async function getSubscriptions(botId: string): Promise<unknown[]> {
  const internalId = await resolveBotId(botId);
  if (!internalId) return [];
  return getBotSubscriptions(botId);
}

/**
 * Cancels a subscription.
 */
export async function cancelSubscription(subscriptionId: string): Promise<boolean> {
  const result = await query(
    `UPDATE bot_subscriptions
     SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'active'
     RETURNING id`,
    [subscriptionId]
  );
  return result.rows.length > 0;
}

/**
 * Retries a failed or expired subscription renewal.
 * Checks the subscriber bot's spending policy before attempting payment.
 */
export async function retrySubscription(subscriptionId: string): Promise<{
  success: boolean;
  status: string;
  reason?: string;
}> {
  const subResult = await query(
    `SELECT bs.*, sb.handle as subscriber_handle, pb.handle as provider_handle
     FROM bot_subscriptions bs
     JOIN bots sb ON bs.subscriber_bot_id = sb.id
     JOIN bots pb ON bs.provider_bot_id = pb.id
     WHERE bs.id = $1`,
    [subscriptionId]
  );

  if (!subResult.rows[0]) {
    return { success: false, status: 'not_found', reason: 'Subscription not found' };
  }

  const sub = subResult.rows[0];
  if (sub.status === 'cancelled') {
    return { success: false, status: 'cancelled', reason: 'Cannot retry a cancelled subscription' };
  }

  const amount = Number(sub.amount);
  const policyCheck = await checkSpendingPolicy(sub.subscriber_bot_id, amount);

  if (!policyCheck.approved) {
    // Record failed reputation event
    await recordReputationEvent(sub.subscriber_bot_id, 'payment_failed', -2,
      `Subscription renewal failed: ${policyCheck.reason}`);

    return { success: false, status: 'policy_rejected', reason: policyCheck.reason };
  }

  // Calculate next payment date based on interval (computed in JS to avoid SQL interpolation)
  const intervalDays: Record<string, number> = {
    daily: 1,
    weekly: 7,
    monthly: 30,
    yearly: 365,
  };
  const daysToAdd = intervalDays[sub.interval as string] ?? 30;
  const nextPaymentDate = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);

  await query(
    `UPDATE bot_subscriptions
     SET status = 'active', last_payment_date = NOW(),
         next_payment_date = $1,
         total_payments = total_payments + 1,
         total_paid = total_paid + $2,
         updated_at = NOW()
     WHERE id = $3`,
    [nextPaymentDate, amount, subscriptionId]
  );

  // Positive reputation events for both parties
  await Promise.all([
    recordReputationEvent(sub.subscriber_bot_id, 'subscription_renewed', +1,
      `Subscription to ${sub.provider_handle} renewed`),
    recordReputationEvent(sub.provider_bot_id, 'subscription_income', +1,
      `Subscription renewed by ${sub.subscriber_handle}`),
  ]);

  logger.info('Subscription renewed', { subscriptionId, amount, subscriber: sub.subscriber_handle });

  return { success: true, status: 'renewed' };
}

/**
 * Processes all subscriptions due for renewal (cron/scheduled runner).
 * Checks each expiring subscription and attempts payment via spending policy.
 */
export async function processSubscriptionRenewals(): Promise<{
  processed: number;
  renewed: number;
  failed: number;
}> {
  // Find subscriptions due within the next hour
  const dueResult = await query(
    `SELECT id FROM bot_subscriptions
     WHERE status = 'active' AND auto_renew = true
       AND next_payment_date <= NOW() + INTERVAL '1 hour'`,
    []
  );

  let renewed = 0;
  let failed = 0;

  for (const row of dueResult.rows) {
    const result = await retrySubscription(row.id);
    if (result.success) {
      renewed++;
    } else {
      failed++;
      // Mark subscription as past_due
      await query(
        `UPDATE bot_subscriptions SET status = 'past_due', updated_at = NOW() WHERE id = $1`,
        [row.id]
      );
    }
  }

  logger.info('Subscription renewal run completed', {
    processed: dueResult.rows.length,
    renewed,
    failed,
  });

  return { processed: dueResult.rows.length, renewed, failed };
}

// ── Reputation Engine ──────────────────────────────────────────────────────

/**
 * Returns reputation data for a bot.
 */
export async function getBotReputation(botId: string): Promise<Record<string, unknown> | null> {
  const internalId = await resolveBotId(botId);
  if (!internalId) return null;

  const [botRow, events] = await Promise.all([
    query(
      `SELECT id, handle, reputation_score, total_transactions,
              successful_transactions, disputed_transactions, tips_received_count
       FROM bots WHERE id = $1`,
      [internalId]
    ),
    query(
      `SELECT event_type, impact, description, created_at
       FROM reputation_events WHERE bot_id = $1
       ORDER BY created_at DESC LIMIT 10`,
      [internalId]
    ),
  ]);

  if (!botRow.rows[0]) return null;
  const bot = botRow.rows[0];

  return {
    botId: bot.id,
    handle: bot.handle,
    reputationScore: Number(bot.reputation_score),
    totalTransactions: Number(bot.total_transactions),
    successfulTransactions: Number(bot.successful_transactions),
    disputedTransactions: Number(bot.disputed_transactions),
    tipsReceivedCount: Number(bot.tips_received_count),
    recentEvents: events.rows,
  };
}

/**
 * Returns the top N bots by reputation score.
 */
export async function getTopReputation(limit = 10): Promise<unknown[]> {
  const result = await query(
    `SELECT id, handle, display_name, reputation_score, total_transactions,
            successful_transactions, tips_received_count
     FROM bots WHERE status = 'active'
     ORDER BY reputation_score DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

/**
 * Records a reputation event for a bot and updates the bot's reputation score.
 * Positive impact increases score; negative impact decreases it (clamped 0–100).
 */
export async function recordReputationEvent(
  botId: string,
  eventType: string,
  impact: number,
  description?: string
): Promise<void> {
  await query(
    `INSERT INTO reputation_events (bot_id, event_type, impact, description)
     VALUES ($1, $2, $3, $4)`,
    [botId, eventType, impact, description ?? null]
  );

  await query(
    `UPDATE bots
     SET reputation_score = GREATEST(0, LEAST(100, reputation_score + $1)),
         updated_at = NOW()
     WHERE id = $2`,
    [impact, botId]
  );

  logger.info('Reputation event recorded', { botId, eventType, impact });
}

// ── Admin Analytics ────────────────────────────────────────────────────────

/**
 * Returns daily stats for a specific date (defaults to today).
 */
export async function getDailyStats(date?: string): Promise<unknown> {
  const targetDate = date ?? new Date().toISOString().split('T')[0];
  const result = await query(
    `SELECT * FROM moltbook_daily_stats WHERE date = $1`,
    [targetDate]
  );
  return result.rows[0] ?? { date: targetDate, message: 'No stats for this date' };
}

/**
 * Returns aggregated tip stats for the last N days.
 */
export async function getTipsStats(days = 30): Promise<unknown> {
  const result = await query(
    `SELECT
       COUNT(*) as total_tips,
       COALESCE(SUM(amount), 0) as total_volume,
       COALESCE(SUM(fee), 0) as total_fees,
       COALESCE(AVG(amount), 0) as avg_tip,
       COUNT(DISTINCT bot_id) as unique_bots_tipped
     FROM human_tips
     WHERE status = 'completed' AND created_at >= NOW() - ($1 * INTERVAL '1 day')`,
    [days]
  );
  return result.rows[0];
}

/**
 * Returns service marketplace stats.
 */
export async function getServicesStats(): Promise<unknown> {
  const result = await query(
    `SELECT
       COUNT(*) as total_services,
       COUNT(*) FILTER (WHERE status = 'active') as active_services,
       COALESCE(SUM(total_revenue), 0) as total_revenue,
       COALESCE(SUM(total_uses), 0) as total_uses,
       COALESCE(AVG(rating), 0) as avg_rating,
       COUNT(DISTINCT category) as categories
     FROM services`,
    []
  );
  return result.rows[0];
}

/**
 * Returns revenue breakdown for the last N days.
 */
export async function getRevenueStats(days = 30): Promise<unknown> {
  const [tipFees, botTxFees, subFees] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(fee), 0) as total
       FROM human_tips WHERE status = 'completed'
         AND created_at >= NOW() - ($1 * INTERVAL '1 day')`,
      [days]
    ),
    query(
      `SELECT COALESCE(SUM(fee), 0) as total
       FROM bot_transactions WHERE status = 'completed'
         AND created_at >= NOW() - ($1 * INTERVAL '1 day')`,
      [days]
    ),
    query(
      `SELECT COALESCE(SUM(amount * 0.03), 0) as total
       FROM bot_subscriptions WHERE status = 'active'
         AND last_payment_date >= NOW() - ($1 * INTERVAL '1 day')`,
      [days]
    ),
  ]);

  const humanTipFees = Number(tipFees.rows[0]?.total ?? 0);
  const botTransactionFees = Number(botTxFees.rows[0]?.total ?? 0);
  const subscriptionFees = Number(subFees.rows[0]?.total ?? 0);

  return {
    period: `${days} days`,
    humanTipFees,
    botTransactionFees,
    subscriptionFees,
    totalFees: humanTipFees + botTransactionFees + subscriptionFees,
  };
}
