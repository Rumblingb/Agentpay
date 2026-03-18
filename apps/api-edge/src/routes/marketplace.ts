/**
 * Marketplace — Agent Discovery & Price Lookup (Cloudflare Workers / Hono)
 *
 * Endpoints:
 *   GET /api/marketplace/discover   — list registered agents (filterable)
 *   GET /api/marketplace/agent/:id  — single agent public profile
 *   GET /api/marketplace/schema     — machine-readable endpoint schema
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';

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
  const { category, minScore, maxPriceUsd, limit = '20', offset = '0' } = c.req.query();

  const limitN  = Math.min(parseInt(limit,  10) || 20, 100);
  const offsetN = Math.max(parseInt(offset, 10) || 0, 0);
  const minScoreN     = minScore     ? parseFloat(minScore)     : null;
  const maxPriceUsdN  = maxPriceUsd  ? parseFloat(maxPriceUsd)  : null;

  const sql = createDb(c.env);
  try {
    // Build filter conditions
    const conditions: string[] = ["verified = true"];
    const params: any[] = [];

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
      `SELECT agent_id, metadata, created_at
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

export { router as marketplaceRouter };
