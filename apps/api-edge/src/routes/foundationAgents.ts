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
// POST /api/foundation-agents/intent — IntentCoordinatorAgent (LIVE)
//
// Orchestrates multi-agent task execution from a natural-language intent.
// Finds the best agent(s), creates a hire plan, and returns an execution graph.
//
// Body: { intent, budget?, callerAgentId?, autoHire? }
// ---------------------------------------------------------------------------

router.post('/intent', async (c) => {
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { intent, budget, callerAgentId, autoHire = false } = body as Record<string, unknown>;

  if (!intent || typeof intent !== 'string' || intent.trim().length < 5) {
    return c.json({
      error: 'intent required (min 5 chars)',
      example: { intent: 'Book a flight from NYC to London on Friday', budget: 50 },
    }, 400);
  }

  const sql = createDb(c.env);

  try {
    // ── Step 1: extract capabilities from intent ───────────────────────────
    const intentLow = intent.toLowerCase();
    const CAPABILITY_SIGNALS: Array<{ keywords: string[]; capability: string; category: string }> = [
      { keywords: ['flight','fly','airline','airport','plane'],       capability: 'flight_booking',  category: 'travel' },
      { keywords: ['hotel','accommodation','stay','room','lodge'],    capability: 'hotel_booking',   category: 'travel' },
      { keywords: ['car','taxi','uber','ride','transport'],           capability: 'transport',        category: 'travel' },
      { keywords: ['research','find','look up','search','discover'],  capability: 'research',         category: 'research' },
      { keywords: ['write','draft','compose','email','message'],      capability: 'writing',          category: 'writing' },
      { keywords: ['code','build','implement','function','api'],      capability: 'code',             category: 'engineering' },
      { keywords: ['image','photo','design','visual','generate'],     capability: 'image_generation', category: 'creative' },
      { keywords: ['data','analyse','analyze','csv','database'],      capability: 'data_analysis',    category: 'data' },
      { keywords: ['translate','translation','language'],             capability: 'translation',      category: 'language' },
      { keywords: ['summarise','summarize','summary','tldr'],         capability: 'summarization',    category: 'writing' },
    ];

    const detectedCapabilities: string[] = [];
    for (const sig of CAPABILITY_SIGNALS) {
      if (sig.keywords.some(kw => intentLow.includes(kw))) {
        detectedCapabilities.push(sig.capability);
      }
    }

    // ── Step 2: find matching agents for each capability ───────────────────
    const primaryCapability = detectedCapabilities[0] ?? null;
    const budgetNum = typeof budget === 'number' ? budget : null;

    // Build parameterized query — never interpolate user-derived values into SQL strings.
    // primaryCapability is always a hardcoded enum string from CAPABILITY_SIGNALS, but we
    // parameterize it anyway so the pattern stays safe if the derivation ever changes.
    const sqlParams: (string | number)[] = [];

    const capCondition = primaryCapability
      ? (() => {
          const likePat      = `%${primaryCapability}%`;
          const shortLikePat = `%${primaryCapability.split('_')[0]}%`;
          sqlParams.push(likePat, primaryCapability, shortLikePat);
          const i = sqlParams.length;
          return `AND (
            LOWER(ai.metadata->>'category') LIKE $${i - 2}
            OR ai.metadata->'capabilities' @> to_jsonb($${i - 1}::text)
            OR LOWER(ai.metadata->>'description') LIKE $${i}
          )`;
        })()
      : '';

    const budgetCondition = budgetNum !== null
      ? (() => {
          sqlParams.push(budgetNum);
          return `AND COALESCE((ai.metadata->>'pricePerTaskUsd')::numeric, 0) <= $${sqlParams.length}`;
        })()
      : '';

    const agentRows = await sql.unsafe<any[]>(
      `SELECT ai.agent_id, ai.metadata, ai.verified, ai.kyc_status,
              COALESCE(ar.score, 100) AS agentrank_score,
              COALESCE(ar.grade, 'New') AS agentrank_grade
       FROM agent_identities ai
       LEFT JOIN agentrank_scores ar ON ar.agent_id = ai.agent_id
       WHERE (ai.verified = true OR ai.kyc_status = 'programmatic')
         ${capCondition}
         ${budgetCondition}
       ORDER BY COALESCE(ar.score, 0) DESC
       LIMIT 5`,
      sqlParams,
    ).catch(() => []);

    const candidates = agentRows.map((r: any) => ({
      agentId:        r.agent_id,
      name:           r.metadata?.name        ?? r.agent_id,
      category:       r.metadata?.category    ?? 'general',
      capabilities:   r.metadata?.capabilities  ?? [],
      pricePerTaskUsd:r.metadata?.pricePerTaskUsd ?? null,
      trustScore:     Number(r.agentrank_score),
      grade:          r.agentrank_grade,
      verified:       r.verified,
    }));

    const bestAgent = candidates[0] ?? null;

    // ── Step 3: build execution plan ──────────────────────────────────────
    const coordinationId = `coord_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    const plan = {
      coordinationId,
      intent,
      detectedCapabilities,
      primaryCapability,
      budget: budgetNum,
      callerAgentId: callerAgentId ?? null,
      steps: detectedCapabilities.length > 0
        ? detectedCapabilities.map((cap, i) => ({
            step:       i + 1,
            capability: cap,
            status:     'pending',
            assignedAgent: cap === primaryCapability ? bestAgent : null,
          }))
        : [{ step: 1, capability: 'general', status: 'pending', assignedAgent: bestAgent }],
      candidateAgents: candidates,
      createdAt: new Date().toISOString(),
    };

    // ── Step 4: auto-hire if requested and a best agent was found ──────────
    let hireResult: Record<string, unknown> | null = null;
    if (autoHire && bestAgent && budgetNum !== null && callerAgentId) {
      const jobId = `job_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await sql`
        INSERT INTO payment_intents
          (id, merchant_id, agent_id, amount, currency, status, verification_token, expires_at, metadata)
        VALUES
          (${jobId}, NULL, ${bestAgent.agentId}, ${budgetNum ?? 0}, ${'USDC'}, ${'escrow_pending'},
           ${`COORD_${coordinationId.slice(0, 8).toUpperCase()}`},
           NOW() + INTERVAL '24 hours',
           ${JSON.stringify({
             protocol:        'intent_coordinator',
             coordinationId,
             intent,
             hirerId:         callerAgentId,
             agentId:         bestAgent.agentId,
             primaryCapability,
           })}::jsonb)
      `.catch(() => {});

      hireResult = {
        jobId,
        hiredAgentId:  bestAgent.agentId,
        hiredAgentName: bestAgent.name,
        agreedPriceUsdc: budgetNum,
        status: 'escrow_pending',
        completeUrl: `/api/marketplace/hire/${jobId}/complete`,
      };
    }

    return c.json({
      success: true,
      coordinationId,
      plan,
      ...(hireResult ? { hire: hireResult } : {}),
      nextSteps: autoHire && hireResult
        ? [`Hired ${hireResult.hiredAgentName}. Call POST ${hireResult.completeUrl} when task is done.`]
        : candidates.length > 0
          ? [
              `Recommended: hire ${bestAgent!.name} (${bestAgent!.agentId}) via POST /api/marketplace/hire`,
              `Or retry with autoHire: true and a budget to auto-execute.`,
            ]
          : ['No matching agents found. Register agents at POST /api/v1/agents/register.'],
      _agent: 'IntentCoordinatorAgent/1.0',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/foundation-agents/identity — IdentityVerifierAgent (Phase 2 stub)
// POST /api/foundation-agents/dispute  — DisputeResolverAgent (Phase 2 stub)
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

export { router as foundationAgentsRouter };
