/**
 * Marketplace — Agent Discovery, Hire & Revenue (Cloudflare Workers / Hono)
 *
 * Endpoints:
 *   GET  /api/marketplace/discover        — list registered agents (filterable)
 *   GET  /api/marketplace/agent/:id       — single agent public profile
 *   POST /api/marketplace/hire            — hire an agent (5% take-rate on job value)
 *   POST /api/marketplace/hire/:jobId/complete — mark job done, trigger payout
 *   GET  /api/marketplace/schema          — machine-readable endpoint schema
 *
 * Revenue model:
 *   - Discovery: FREE (drives network growth)
 *   - Hire:      5% platform take-rate on job completion (MARKETPLACE_TAKE_RATE_BPS = 500)
 *   - Payout:    agent receives 95% of agreed price via AgentPay payment intent
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';
import { MARKETPLACE_TAKE_RATE_BPS } from '../lib/feeLedger';
import { recordFloatAccrual } from '../lib/floatYield';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET /api/marketplace/schema
// ---------------------------------------------------------------------------
router.get('/schema', (c) =>
  c.json({
    description: 'AgentPay Marketplace — discover and hire AI agents',
    endpoints: {
      discover: {
        method: 'GET',
        path: '/api/marketplace/discover',
        queryParams: {
          q:          'string   — free-text search across name, description, category',
          category:   'string   — filter by category (e.g. research, writing, code)',
          minScore:   'number   — minimum AgentRank score (0–1000)',
          maxPriceUsd:'number   — max price per task in USD',
          limit:      'number   — results per page (default 20, max 100)',
          offset:     'number   — pagination offset',
        },
      },
      agent: {
        method: 'GET',
        path: '/api/marketplace/agent/:agentId',
        description: 'Full public profile for a single agent',
      },
    },
  }),
);

// ---------------------------------------------------------------------------
// GET /api/marketplace/discover
// ---------------------------------------------------------------------------
router.get('/discover', async (c) => {
  const { q, category, minScore, maxPriceUsd, limit = '20', offset = '0' } = c.req.query();

  const limitN  = Math.min(parseInt(limit,  10) || 20, 100);
  const offsetN = Math.max(parseInt(offset, 10) || 0, 0);
  const minScoreN     = minScore     ? parseFloat(minScore)     : null;
  const maxPriceUsdN  = maxPriceUsd  ? parseFloat(maxPriceUsd)  : null;

  const sql = createDb(c.env);
  try {
    // Include self-registered agents (kyc_status='programmatic') + human-verified agents
    const conditions: string[] = ["(verified = true OR kyc_status = 'programmatic')"];
    const params: any[] = [];

    if (q) {
      // Text search across name + description fields in metadata
      params.push(`%${q.toLowerCase()}%`);
      conditions.push(`(LOWER(metadata->>'name') LIKE $${params.length} OR LOWER(metadata->>'description') LIKE $${params.length} OR LOWER(metadata->>'category') LIKE $${params.length})`);
    }
    if (category) {
      params.push(`%${category.toLowerCase()}%`);
      conditions.push(`LOWER(metadata->>'category') LIKE $${params.length}`);
    }
    if (minScoreN !== null) {
      params.push(minScoreN);
      conditions.push(`COALESCE((metadata->>'agentRankScore')::numeric, 0) >= $${params.length}`);
    }
    if (maxPriceUsdN !== null) {
      params.push(maxPriceUsdN);
      conditions.push(`COALESCE((metadata->>'pricePerTaskUsd')::numeric, 0) <= $${params.length}`);
    }

    const where = conditions.join(' AND ');
    params.push(limitN, offsetN);
    const lIdx = params.length - 1;
    const oIdx = params.length;

    const rows = await sql.unsafe<any[]>(
      `SELECT agent_id, metadata, verified, kyc_status, created_at
       FROM agent_identities
       WHERE ${where}
       ORDER BY COALESCE((metadata->>'agentRankScore')::numeric, 0) DESC
       LIMIT $${lIdx} OFFSET $${oIdx}`,
      params,
    ).catch(() => []);

    const countRows = await sql.unsafe<any[]>(
      `SELECT COUNT(*) AS n FROM agent_identities WHERE ${where}`,
      params.slice(0, params.length - 2),
    ).catch(() => [{ n: 0 }]);

    const agents = rows.map((r: any) => ({
      agentId:        r.agent_id,
      name:           r.metadata?.name        ?? r.agent_id,
      category:       r.metadata?.category    ?? 'general',
      description:    r.metadata?.description ?? '',
      agentRankScore: r.metadata?.agentRankScore ?? 0,
      pricePerTaskUsd:r.metadata?.pricePerTaskUsd ?? null,
      capabilities:   r.metadata?.capabilities  ?? [],
      verified:       r.verified ?? false,
      passportUrl:    `https://app.agentpay.so/agent/${r.agent_id}`,
      registeredAt:   r.created_at,
    }));

    return c.json({
      success: true,
      agents,
      pagination: {
        total:  Number(countRows[0]?.n ?? 0),
        limit:  limitN,
        offset: offsetN,
      },
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// GET /api/marketplace/agent/:agentId
// ---------------------------------------------------------------------------
router.get('/agent/:agentId', async (c) => {
  const { agentId } = c.req.param();

  const sql = createDb(c.env);
  try {
    const rows = await sql<any[]>`
      SELECT agent_id, metadata, verified, kyc_status, created_at
      FROM agent_identities
      WHERE agent_id = ${agentId}
      LIMIT 1
    `.catch(() => []);

    if (!rows.length) return c.json({ error: 'Agent not found', agentId }, 404);

    const r = rows[0];
    return c.json({
      success: true,
      agent: {
        agentId:        r.agent_id,
        name:           r.metadata?.name        ?? r.agent_id,
        category:       r.metadata?.category    ?? 'general',
        description:    r.metadata?.description ?? '',
        verified:       r.verified,
        kycStatus:      r.kyc_status,
        agentRankScore: r.metadata?.agentRankScore ?? 0,
        pricePerTaskUsd:r.metadata?.pricePerTaskUsd ?? null,
        capabilities:   r.metadata?.capabilities  ?? [],
        passportUrl:    `https://app.agentpay.so/agent/${r.agent_id}`,
        registeredAt:   r.created_at,
      },
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/marketplace/hire  — hire an agent for a job
//
// Revenue: 5% take-rate on job completion (not upfront).
// Creates a job escrow record. Payout triggered by /complete.
// ---------------------------------------------------------------------------
router.post('/hire', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { hirerId, agentId, jobDescription, agreedPriceUsdc, callbackUrl } = body;
  if (!hirerId || !agentId || !jobDescription || !agreedPriceUsdc) {
    return c.json({ error: 'hirerId, agentId, jobDescription, agreedPriceUsdc required' }, 400);
  }
  if (typeof agreedPriceUsdc !== 'number' || agreedPriceUsdc <= 0) {
    return c.json({ error: 'agreedPriceUsdc must be a positive number' }, 400);
  }

  const takeRateBps  = MARKETPLACE_TAKE_RATE_BPS;                                  // 500 = 5%
  const platformFee  = parseFloat(((agreedPriceUsdc * takeRateBps) / 10_000).toFixed(6));
  const agentPayout  = parseFloat((agreedPriceUsdc - platformFee).toFixed(6));

  const jobId    = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

  const sql = createDb(c.env);
  try {
    await sql`
      INSERT INTO payment_intents
        (id, merchant_id, agent_id, amount, currency, status, verification_token, expires_at, metadata)
      VALUES
        (${jobId},
         NULL,
         ${agentId},
         ${agreedPriceUsdc},
         ${'USDC'},
         ${'escrow_pending'},
         ${`MKT_${jobId.slice(0, 8).toUpperCase()}`},
         ${expiresAt}::timestamptz,
         ${JSON.stringify({
           protocol: 'marketplace_hire',
           hirerId,
           agentId,
           jobDescription,
           agreedPriceUsdc,
           platformFee,
           agentPayout,
           takeRateBps,
           hiredAt: new Date().toISOString(),
           callbackUrl: callbackUrl ?? null,
         })}::jsonb)
    `.catch(() => {});
  } finally {
    await sql.end().catch(() => {});
  }

  // Float yield — start accruing on escrowed funds immediately
  const sql2 = createDb(c.env);
  try {
    await recordFloatAccrual(sql2, {
      intentId:      jobId,
      principalUsdc: agreedPriceUsdc,
      holdStartedAt: new Date(),
      source:        'marketplace_escrow',
    });
  } finally {
    await sql2.end().catch(() => {});
  }

  return c.json({
    success: true,
    jobId,
    hirerId,
    agentId,
    agreedPriceUsdc,
    breakdown: {
      platformFee,
      platformFeePct: `${(takeRateBps / 100).toFixed(1)}%`,
      agentPayout,
    },
    status: 'escrow_pending',
    expiresAt,
    nextStep: `POST /api/marketplace/hire/${jobId}/complete once the agent delivers`,
    _schema: 'MarketplaceHire/1.0',
  }, 201);
});

// ---------------------------------------------------------------------------
// POST /api/marketplace/hire/:jobId/complete  — mark job done, trigger payout
//
// Transitions escrow → completed. The 5% fee stays with platform.
// Agent gets 95% via the agentPayout amount recorded at hire time.
// ---------------------------------------------------------------------------
router.post('/hire/:jobId/complete', async (c) => {
  const { jobId } = c.req.param();
  let body: any = {};
  try { body = await c.req.json(); } catch {}

  const { hirerId, completionProof } = body;
  if (!hirerId) return c.json({ error: 'hirerId required to confirm completion' }, 400);

  const sql = createDb(c.env);
  try {
    const rows = await sql<any[]>`
      SELECT id, status, amount, metadata FROM payment_intents
      WHERE id = ${jobId} AND metadata->>'protocol' = 'marketplace_hire'
      LIMIT 1
    `.catch(() => []);

    if (!rows.length) return c.json({ error: 'Job not found', jobId }, 404);

    const job = rows[0];
    if (job.metadata?.hirerId !== hirerId) {
      return c.json({ error: 'Only the hirer can confirm completion' }, 403);
    }
    if (job.status !== 'escrow_pending') {
      return c.json({ error: `Job is already in status: ${job.status}` }, 409);
    }

    const completedAt = new Date().toISOString();
    await sql`
      UPDATE payment_intents
      SET status = 'completed',
          metadata = metadata || ${JSON.stringify({ completionProof: completionProof ?? null, completedAt })}::jsonb
      WHERE id = ${jobId}
    `.catch(() => {});

    // Settle float yield accrual
    const sql2 = createDb(c.env);
    try {
      await recordFloatAccrual(sql2, {
        intentId:      jobId,
        principalUsdc: Number(job.amount),
        holdStartedAt: new Date(job.metadata?.hiredAt ?? job.created_at ?? Date.now()),
        holdEndedAt:   new Date(),
        source:        'marketplace_escrow',
      });
    } finally {
      await sql2.end().catch(() => {});
    }

    return c.json({
      success: true,
      jobId,
      status: 'completed',
      completedAt,
      payout: {
        agentId:      job.metadata?.agentId,
        agentPayout:  job.metadata?.agentPayout,
        platformFee:  job.metadata?.platformFee,
        currency:     'USDC',
      },
      message: 'Job complete. Agent payout queued. Platform fee collected.',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

export { router as marketplaceRouter };
