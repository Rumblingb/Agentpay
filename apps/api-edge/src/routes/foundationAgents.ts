/**
 * Foundation Agents — Workers runtime implementations
 *
 * ReputationOracleAgent — live (backed by agentrank_scores + agent_identities)
 *   POST /api/foundation-agents/reputation  { action, agentId, agentIds? }
 *
 * Actions:
 *   get_reputation   — full trust profile for one agent
 *   get_trust_score  — lightweight score + grade
 *   compare          — compare two agents side-by-side
 *   batch_lookup     — up to 20 agents in one call (enterprise)
 *
 * Pricing: usage tracked via X-AgentPay-Tier header (starter: free tier)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchAgentRank(sql: ReturnType<typeof createDb>, agentId: string) {
  const [rankRows, identityRows] = await Promise.all([
    sql`
      SELECT agent_id AS "agentId", score, grade,
             payment_reliability AS "paymentReliability",
             service_delivery    AS "serviceDelivery",
             transaction_volume  AS "transactionVolume",
             dispute_rate        AS "disputeRate",
             unique_counterparties AS "uniqueCounterparties",
             stake_usdc          AS "stakeUsdc",
             factors, updated_at AS "updatedAt"
      FROM agentrank_scores WHERE agent_id = ${agentId} LIMIT 1
    `.catch(() => []),
    sql`
      SELECT verified, kyc_status AS "kycStatus", created_at AS "registeredAt", metadata
      FROM agent_identities WHERE agent_id = ${agentId} LIMIT 1
    `.catch(() => []),
  ]);

  const rank = rankRows[0] ?? null;
  const identity = identityRows[0] ?? null;
  if (!rank && !identity) return null;

  return {
    agentId,
    trustScore: rank?.score ?? 0,
    grade: rank?.grade ?? 'U',
    paymentReliability: rank ? Number(rank.paymentReliability) : null,
    serviceDelivery: rank ? Number(rank.serviceDelivery) : null,
    transactionVolume: rank ? Number(rank.transactionVolume) : 0,
    disputeRate: rank ? Number(rank.disputeRate) : 0,
    uniqueCounterparties: rank?.uniqueCounterparties ?? 0,
    stakeUsdc: rank ? Number(rank.stakeUsdc) : 0,
    verified: identity?.verified ?? false,
    kycStatus: identity?.kycStatus ?? 'unverified',
    registeredAt: identity?.registeredAt ?? null,
    category: (identity?.metadata as any)?.category ?? 'general',
    name: (identity?.metadata as any)?.name ?? agentId,
    updatedAt: rank?.updatedAt ?? null,
    profileUrl: `https://agentpay.so/agent/${agentId}`,
  };
}

// ---------------------------------------------------------------------------
// POST /api/foundation-agents/reputation
// ---------------------------------------------------------------------------

router.post('/reputation', async (c) => {
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { action, agentId, agentIds, compareWith } = body as Record<string, unknown>;

  if (!action || typeof action !== 'string') {
    return c.json({ error: 'action required', validActions: ['get_reputation', 'get_trust_score', 'compare', 'batch_lookup'] }, 400);
  }

  const sql = createDb(c.env);

  try {
    // ── get_reputation ─────────────────────────────────────────────────────
    if (action === 'get_reputation' || action === 'get_trust_score') {
      if (!agentId || typeof agentId !== 'string') {
        return c.json({ error: 'agentId required for ' + action }, 400);
      }
      const profile = await fetchAgentRank(sql, agentId);
      if (!profile) {
        return c.json({ error: 'AGENT_NOT_FOUND', agentId, trustScore: 0, grade: 'U' }, 404);
      }
      if (action === 'get_trust_score') {
        return c.json({
          success: true,
          agentId: profile.agentId,
          trustScore: profile.trustScore,
          grade: profile.grade,
          verified: profile.verified,
          updatedAt: profile.updatedAt,
          _agent: 'ReputationOracleAgent/1.0',
        });
      }
      return c.json({ success: true, reputation: profile, _agent: 'ReputationOracleAgent/1.0' });
    }

    // ── compare ────────────────────────────────────────────────────────────
    if (action === 'compare') {
      if (!agentId || typeof agentId !== 'string' || !compareWith || typeof compareWith !== 'string') {
        return c.json({ error: 'agentId and compareWith required for compare' }, 400);
      }
      const [a, b] = await Promise.all([
        fetchAgentRank(sql, agentId),
        fetchAgentRank(sql, compareWith),
      ]);
      const winner = !a ? compareWith : !b ? agentId
        : a.trustScore >= b.trustScore ? agentId : compareWith;
      return c.json({
        success: true,
        comparison: { agentA: a, agentB: b },
        recommendation: winner,
        delta: a && b ? a.trustScore - b.trustScore : null,
        _agent: 'ReputationOracleAgent/1.0',
      });
    }

    // ── batch_lookup ───────────────────────────────────────────────────────
    if (action === 'batch_lookup') {
      if (!Array.isArray(agentIds) || agentIds.length === 0) {
        return c.json({ error: 'agentIds array required for batch_lookup' }, 400);
      }
      const ids = (agentIds as string[]).slice(0, 20);
      const results = await Promise.all(ids.map((id) => fetchAgentRank(sql, id)));
      const profiles = results.filter(Boolean);
      return c.json({
        success: true,
        requested: ids.length,
        found: profiles.length,
        agents: profiles,
        _agent: 'ReputationOracleAgent/1.0',
      });
    }

    return c.json({ error: 'Unknown action', validActions: ['get_reputation', 'get_trust_score', 'compare', 'batch_lookup'] }, 400);

  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/foundation-agents/identity — IdentityVerifierAgent (Phase 2 stub)
// POST /api/foundation-agents/dispute  — DisputeResolverAgent (Phase 2 stub)
// POST /api/foundation-agents/intent   — IntentCoordinatorAgent (Phase 2 stub)
// ---------------------------------------------------------------------------

const phase2Stub = (name: string) => (c: any) =>
  c.json({
    error: 'NOT_YET_AVAILABLE',
    agent: name,
    message: `${name} execution is Phase 2. The data layer is live — use the REST endpoints today.`,
    alternatives: {
      identity: 'GET /api/v1/agents/:agentId',
      reputation: 'POST /api/foundation-agents/reputation',
      payments: 'POST /api/v1/payment-intents',
    },
    eta: 'Phase 2',
    _schema: 'FoundationAgent/Stub/1.0',
  }, 503);

router.post('/identity', phase2Stub('IdentityVerifierAgent'));
router.post('/dispute', phase2Stub('DisputeResolverAgent'));
router.post('/intent', phase2Stub('IntentCoordinatorAgent'));

export { router as foundationAgentsRouter };
