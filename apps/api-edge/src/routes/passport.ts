/**
 * AgentPassport routes
 *
 *   GET /api/passport/:agentId  — full AgentPassport (public, no auth)
 *   GET /api/agentrank/:agentId — trust score summary (public, no auth)
 *
 * Both are intentionally unauthenticated — the trust graph is the
 * product's free-to-read moat. Agents can be verified before any
 * transaction begins.
 *
 * Data sources (best-effort joins — missing tables return safe nulls):
 *   agentrank_scores  — trust score, grade, reliability, volume, dispute_rate
 *   agent_identities  — verified status, kyc_status, registered_at
 *   payment_intents   — last_active_at (latest confirmed intent)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET /api/passport/:agentId
// ---------------------------------------------------------------------------

router.get('/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  if (!agentId || agentId.trim() === '') {
    return c.json({ error: 'INVALID_AGENT_ID', message: 'agentId is required.' }, 400);
  }

  const sql = createDb(c.env);
  try {
    // AgentRank scores — primary trust data
    const rankRows = await sql`
      SELECT
        agent_id          AS "agentId",
        score,
        grade,
        payment_reliability AS "paymentReliability",
        service_delivery    AS "serviceDelivery",
        transaction_volume  AS "transactionVolume",
        dispute_rate        AS "disputeRate",
        unique_counterparties AS "uniqueCounterparties",
        stake_usdc          AS "stakeUsdc",
        factors,
        history,
        created_at          AS "createdAt",
        updated_at          AS "updatedAt"
      FROM agentrank_scores
      WHERE agent_id = ${agentId}
      LIMIT 1
    `.catch(() => []);

    // Agent identity — verified flag and registration date
    const identityRows = await sql`
      SELECT
        agent_id    AS "agentId",
        verified,
        kyc_status  AS "kycStatus",
        created_at  AS "registeredAt",
        metadata
      FROM agent_identities
      WHERE agent_id = ${agentId}
      LIMIT 1
    `.catch(() => []);

    // Last active — most recent confirmed payment intent involving this agent
    const activityRows = await sql`
      SELECT MAX(created_at) AS "lastActiveAt"
      FROM payment_intents
      WHERE agent_id = ${agentId}
        AND status IN ('confirmed', 'verified', 'completed')
    `.catch(() => []);

    const rank = rankRows[0] ?? null;
    const identity = identityRows[0] ?? null;
    const lastActiveAt = activityRows[0]?.lastActiveAt ?? null;

    if (!rank && !identity) {
      return c.json(
        {
          error: 'AGENT_NOT_FOUND',
          message: `No passport found for agent ${agentId}. Agents appear in the registry after their first confirmed transaction.`,
          agentId,
        },
        404,
      );
    }

    const passport = {
      agentId,
      // Identity
      verified: identity?.verified ?? false,
      kycStatus: identity?.kycStatus ?? 'unverified',
      registeredAt: identity?.registeredAt ?? rank?.createdAt ?? null,
      lastActiveAt: lastActiveAt ?? rank?.updatedAt ?? null,
      // Trust & rank
      trustScore: rank?.score ?? 0,
      grade: rank?.grade ?? 'U',
      paymentReliability: rank ? Number(rank.paymentReliability) : null,
      serviceDelivery: rank ? Number(rank.serviceDelivery) : null,
      transactionVolume: rank ? Number(rank.transactionVolume) : 0,
      disputeRate: rank ? Number(rank.disputeRate) : 0,
      uniqueCounterparties: rank?.uniqueCounterparties ?? 0,
      stakeUsdc: rank ? Number(rank.stakeUsdc) : 0,
      // History snapshot (last 10 score events)
      history: Array.isArray(rank?.history) ? (rank.history as unknown[]).slice(-10) : [],
      // Public profile URL
      profileUrl: `https://agentpay.so/agent/${agentId}`,
      // Protocol metadata
      _schema: 'AgentPassport/1.0',
      _network: 'agentpay',
    };

    const tier = c.req.header('X-AgentPay-Tier') ?? 'starter';
    const isPremium = tier === 'enterprise' || tier === 'growth';

    // Metered usage — track AgentRank reads for billing (best-effort, non-blocking)
    if (isPremium) {
      const apiKey = c.req.header('X-Api-Key') ?? 'anonymous';
      const sql2 = createDb(c.env);
      sql2`
        INSERT INTO api_usage_metrics (api_key, endpoint, called_at)
        VALUES (${apiKey}, 'passport_read', NOW())
      `.catch(() => {}).finally(() => sql2.end().catch(() => {}));
    }

    return c.json({
      success: true,
      passport,
      _tier: tier,
      _rateLimit: tier === 'starter'
        ? 'Free tier: 60/min. Upgrade to Growth (apk_grow_*) for 180/min or Enterprise for 600/min.'
        : `${tier} tier active — elevated limits applied.`,
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// GET /api/agentrank/:agentId — lightweight trust score (for quick lookups)
// ---------------------------------------------------------------------------

router.get('/rank/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  if (!agentId || agentId.trim() === '') {
    return c.json({ error: 'INVALID_AGENT_ID', message: 'agentId is required.' }, 400);
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql`
      SELECT
        agent_id   AS "agentId",
        score,
        grade,
        payment_reliability AS "paymentReliability",
        transaction_volume  AS "transactionVolume",
        dispute_rate        AS "disputeRate",
        updated_at          AS "updatedAt"
      FROM agentrank_scores
      WHERE agent_id = ${agentId}
      LIMIT 1
    `.catch(() => []);

    if (!rows[0]) {
      return c.json(
        {
          error: 'NOT_RANKED',
          message: `Agent ${agentId} has no AgentRank score yet. Scores are assigned after the first confirmed transaction.`,
          agentId,
          score: 0,
          grade: 'U',
        },
        404,
      );
    }

    const r = rows[0];
    return c.json({
      success: true,
      agentId: r.agentId,
      score: r.score,
      grade: r.grade,
      paymentReliability: Number(r.paymentReliability),
      transactionVolume: Number(r.transactionVolume),
      disputeRate: Number(r.disputeRate),
      updatedAt: r.updatedAt,
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

export { router as passportRouter };
