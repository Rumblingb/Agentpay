/**
 * Agent Runtime Matching — /api/agents/match
 *
 * Intent-based capability matching for A2A workflows.
 * Agents and orchestrators call this to find the best agent for a task at runtime.
 *
 * GET /api/agents/match
 *   Query: capability, maxPriceUsd, minScore, limit
 *   Returns: ranked list of matching agents with passport data
 *
 * POST /api/agents/match
 *   Body: { intent, capability?, maxPriceUsd?, minScore?, limit? }
 *   Returns: same, but intent string is matched via keyword extraction
 *
 * Ranking algorithm (descending priority):
 *   1. Exact capability match (in capabilities array)
 *   2. Category match
 *   3. AgentRank trust score
 *   4. Price (cheaper ranks higher at equal trust)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb, parseJsonb } from '../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── helpers ────────────────────────────────────────────────────────────────

/** Extract keywords from a natural-language intent string */
function extractKeywords(intent: string): string[] {
  const STOP = new Set([
    'a','an','the','is','are','was','were','to','for','of','in','on','at',
    'and','or','but','with','that','this','it','i','need','want','find',
    'me','my','can','do','please','help','get','the','some','any',
  ]);
  return intent
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w));
}

/** Score a row against search terms — higher = better match */
function rankRow(r: any, keywords: string[], capability?: string): number {
  let score = Number(r.agentrank_score ?? 0);
  const meta = r._parsedMeta ?? {};
  const caps: string[] = Array.isArray(meta.capabilities) ? meta.capabilities : [];
  const cat: string = (meta.category ?? '').toLowerCase();
  const name: string = (meta.name ?? '').toLowerCase();
  const desc: string = (meta.description ?? '').toLowerCase();

  // Exact capability match → strong boost
  if (capability) {
    const capLow = capability.toLowerCase();
    if (caps.some(c => c.toLowerCase() === capLow)) score += 500;
    else if (caps.some(c => c.toLowerCase().includes(capLow))) score += 200;
    else if (cat.includes(capLow)) score += 100;
  }

  // Keyword match across name + description + capabilities
  for (const kw of keywords) {
    if (name.includes(kw)) score += 30;
    if (desc.includes(kw)) score += 20;
    if (cat.includes(kw)) score += 25;
    if (caps.some(c => c.toLowerCase().includes(kw))) score += 40;
  }

  return score;
}

// ─── shared match logic ──────────────────────────────────────────────────────

async function matchAgents(
  sql: ReturnType<typeof createDb>,
  {
    intent,
    capability,
    maxPriceUsd,
    minScore,
    limit,
  }: {
    intent?: string;
    capability?: string;
    maxPriceUsd?: number;
    minScore?: number;
    limit: number;
  },
) {
  const keywords = intent ? extractKeywords(intent) : [];
  const capLow = capability?.toLowerCase();

  // Fetch candidates — filter by price + agentrank, then rank in-process
  const conditions: string[] = ["(verified = true OR kyc_status = 'programmatic')"];
  const params: any[] = [];

  if (minScore !== undefined && minScore > 0) {
    params.push(minScore);
    conditions.push(`COALESCE(ar.score, 0) >= $${params.length}`);
  }
  if (maxPriceUsd !== undefined) {
    params.push(maxPriceUsd);
    conditions.push(`COALESCE((ai.metadata->>'pricePerTaskUsd')::numeric, 0) <= $${params.length}`);
  }

  // If we have a capability hint, pre-filter by category, capabilities text, or description
  if (capLow) {
    params.push(`%${capLow}%`);
    const pIdx = params.length;
    conditions.push(
      `(LOWER(ai.metadata->>'category') LIKE $${pIdx}` +
      ` OR LOWER(ai.metadata::text) LIKE $${pIdx}` +
      ` OR LOWER(ai.metadata->>'description') LIKE $${pIdx})`,
    );
  } else if (keywords.length) {
    // General keyword pre-filter — cast whole metadata to text and search
    const kwPattern = `%${keywords[0]}%`;
    params.push(kwPattern);
    const pIdx = params.length;
    conditions.push(`LOWER(ai.metadata::text) LIKE $${pIdx}`);
  }

  const where = conditions.join(' AND ');
  // Fetch 5× the requested limit so we have room to rank
  params.push(limit * 5);

  const rows = await sql.unsafe<any[]>(
    `SELECT ai.agent_id, ai.metadata, ai.verified, ai.kyc_status, ai.created_at,
            COALESCE(ar.score, 100) AS agentrank_score,
            COALESCE(ar.grade, 'New') AS agentrank_grade,
            COALESCE(ar.transaction_volume, 0) AS tx_volume,
            COALESCE(ar.dispute_rate, 0) AS dispute_rate
     FROM agent_identities ai
     LEFT JOIN agentrank_scores ar ON ar.agent_id = ai.agent_id
     WHERE ${where}
     ORDER BY COALESCE(ar.score, 0) DESC
     LIMIT $${params.length}`,
    params,
  ).catch(() => []);

  // Parse jsonb metadata (Hyperdrive returns it as a raw string with fetch_types:false)
  const parsedRows = rows.map(r => ({ ...r, _parsedMeta: parseJsonb(r.metadata, {} as Record<string, unknown>) }));

  // In-memory ranking
  const scored = parsedRows.map(r => ({
    row: r,
    matchScore: rankRow(r, keywords, capability),
  }));
  scored.sort((a, b) => b.matchScore - a.matchScore);

  return scored.slice(0, limit).map(({ row: r, matchScore }) => {
    const m = r._parsedMeta;
    return {
    agentId:        r.agent_id,
    name:           (m.name        as string)   ?? r.agent_id,
    category:       (m.category    as string)   ?? 'general',
    description:    (m.description as string)   ?? '',
    capabilities:   (m.capabilities as string[]) ?? [],
    pricePerTaskUsd:(m.pricePerTaskUsd as number) ?? null,
    trustScore:     Number(r.agentrank_score),
    grade:          r.agentrank_grade,
    txVolume:       Number(r.tx_volume),
    disputeRate:    Number(r.dispute_rate),
    verified:       r.verified ?? false,
    matchScore,
    passportUrl:    `https://agentpay.so/agent/${r.agent_id}`,
    registeredAt:   r.created_at,
  };
  });
}

// ---------------------------------------------------------------------------
// GET /api/agents/match
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const { capability, maxPriceUsd, minScore, limit = '10' } = c.req.query();

  const limitN = Math.min(parseInt(limit, 10) || 10, 50);
  const maxPriceN = maxPriceUsd ? parseFloat(maxPriceUsd) : undefined;
  const minScoreN = minScore    ? parseFloat(minScore)    : undefined;

  const sql = createDb(c.env);
  try {
    const agents = await matchAgents(sql, {
      capability,
      maxPriceUsd: maxPriceN,
      minScore:    minScoreN,
      limit:       limitN,
    });

    return c.json({
      success: true,
      matched:  agents.length,
      agents,
      query: { capability, maxPriceUsd: maxPriceN, minScore: minScoreN, limit: limitN },
      _schema: 'AgentMatch/1.0',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/agents/match  — intent-based matching
//
// Body: { intent, capability?, maxPriceUsd?, minScore?, limit? }
// Intent is a natural-language task description; keywords are extracted and
// matched against agent names, descriptions, and capability arrays.
// ---------------------------------------------------------------------------

router.post('/', async (c) => {
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const {
    intent,
    capability,
    maxPriceUsd,
    minScore,
    limit = 10,
  } = body as Record<string, unknown>;

  if (!intent || typeof intent !== 'string') {
    return c.json({
      error: 'intent required',
      example: { intent: 'find me a flight to NYC', capability: 'travel', maxPriceUsd: 50 },
    }, 400);
  }

  const limitN = Math.min(typeof limit === 'number' ? limit : 10, 50);
  const maxPriceN = typeof maxPriceUsd === 'number' ? maxPriceUsd : undefined;
  const minScoreN = typeof minScore    === 'number' ? minScore    : undefined;
  const capStr    = typeof capability  === 'string' ? capability  : undefined;

  const sql = createDb(c.env);
  try {
    const agents = await matchAgents(sql, {
      intent,
      capability:  capStr,
      maxPriceUsd: maxPriceN,
      minScore:    minScoreN,
      limit:       limitN,
    });

    return c.json({
      success: true,
      intent,
      matched:  agents.length,
      agents,
      _schema: 'AgentMatch/1.0',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

export { router as agentMatchRouter };
