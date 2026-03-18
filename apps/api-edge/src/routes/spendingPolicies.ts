/**
 * Spending Policies — /api/v1/agents/:agentId/policy
 *
 * Per-agent spending controls for enterprise deployments.
 * Policies are enforced at payment-intent creation time by the policy middleware.
 *
 * Endpoints:
 *   GET    /api/v1/agents/:agentId/policy         — read current policy
 *   PUT    /api/v1/agents/:agentId/policy         — set/replace policy
 *   DELETE /api/v1/agents/:agentId/policy         — remove policy (unlimited)
 *
 * Auth: agentKey in X-Agent-Key header (agent sets own policy),
 *       OR admin key in X-Admin-Key header (operator sets policy for agent).
 *
 * Policy schema:
 * {
 *   maxSinglePaymentUsdc: number | null    — per-transaction cap
 *   maxDailyUsdc:         number | null    — rolling 24h cap
 *   maxMonthlyUsdc:       number | null    — calendar month cap
 *   allowedRecipients:    string[] | null  — whitelist of agentIds/addresses (null = all)
 *   blockedRecipients:    string[] | null  — blacklist
 *   requireApprovalAbove: number | null    — manual approval threshold
 *   allowedCategories:    string[] | null  — only spend on these agent categories
 *   pausedUntil:          string | null    — ISO timestamp, blocks all spending until then
 *   enabled:              boolean          — master kill switch
 * }
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb, parseJsonb } from '../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── helpers ────────────────────────────────────────────────────────────────

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function isAuthorized(
  sql: ReturnType<typeof createDb>,
  agentId: string,
  agentKey: string | undefined,
  adminKey: string | undefined,
  envAdminKey: string | undefined,
): Promise<boolean> {
  // Admin override
  if (adminKey && envAdminKey && adminKey === envAdminKey) return true;
  // Agent self-auth
  if (!agentKey) return false;
  const keyHash = await sha256(agentKey);
  const rows = await sql<any[]>`
    SELECT metadata FROM agent_identities WHERE agent_id = ${agentId} LIMIT 1
  `.catch(() => []);
  const meta = parseJsonb(rows[0]?.metadata, {} as Record<string, unknown>);
  return rows.length > 0 && meta.agentKeyHash === keyHash;
}

const POLICY_DEFAULTS = {
  maxSinglePaymentUsdc: null,
  maxDailyUsdc:         null,
  maxMonthlyUsdc:       null,
  allowedRecipients:    null,
  blockedRecipients:    null,
  requireApprovalAbove: null,
  allowedCategories:    null,
  pausedUntil:          null,
  enabled:              true,
};

function validatePolicy(p: Record<string, unknown>): string | null {
  const numFields = ['maxSinglePaymentUsdc','maxDailyUsdc','maxMonthlyUsdc','requireApprovalAbove'];
  for (const f of numFields) {
    if (p[f] !== undefined && p[f] !== null && (typeof p[f] !== 'number' || (p[f] as number) <= 0)) {
      return `${f} must be a positive number or null`;
    }
  }
  const arrFields = ['allowedRecipients','blockedRecipients','allowedCategories'];
  for (const f of arrFields) {
    if (p[f] !== undefined && p[f] !== null && !Array.isArray(p[f])) {
      return `${f} must be an array or null`;
    }
  }
  if (p.pausedUntil !== undefined && p.pausedUntil !== null) {
    if (typeof p.pausedUntil !== 'string' || isNaN(Date.parse(p.pausedUntil as string))) {
      return 'pausedUntil must be an ISO timestamp string or null';
    }
  }
  if (p.enabled !== undefined && typeof p.enabled !== 'boolean') {
    return 'enabled must be a boolean';
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/v1/agents/:agentId/policy
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const agentId = c.req.param('agentId');
  const sql = createDb(c.env);
  try {
    const rows = await sql<any[]>`
      SELECT policy FROM agent_spending_policies WHERE agent_id = ${agentId} LIMIT 1
    `.catch(() => []);

    if (!rows.length) {
      return c.json({
        success: true,
        agentId,
        policy: null,
        message: 'No policy set — agent has no spending restrictions.',
        defaults: POLICY_DEFAULTS,
        _schema: 'SpendingPolicy/1.0',
      });
    }

    return c.json({
      success: true,
      agentId,
      policy: parseJsonb(rows[0].policy, POLICY_DEFAULTS),
      _schema: 'SpendingPolicy/1.0',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// PUT /api/v1/agents/:agentId/policy
// ---------------------------------------------------------------------------

router.put('/', async (c) => {
  const agentId = c.req.param('agentId');
  const agentKey = c.req.header('x-agent-key') ?? c.req.header('X-Agent-Key');
  const adminKey = c.req.header('x-admin-key') ?? c.req.header('X-Admin-Key');

  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const sql = createDb(c.env);
  try {
    if (!(await isAuthorized(sql, agentId, agentKey, adminKey, c.env.ADMIN_SECRET_KEY))) {
      return c.json({ error: 'UNAUTHORIZED — provide X-Agent-Key or X-Admin-Key' }, 401);
    }

    const validationError = validatePolicy(body);
    if (validationError) return c.json({ error: validationError }, 400);

    const policy = { ...POLICY_DEFAULTS, ...body };

    await sql`
      INSERT INTO agent_spending_policies (agent_id, policy, updated_at)
      VALUES (${agentId}, ${JSON.stringify(policy)}::jsonb, NOW())
      ON CONFLICT (agent_id) DO UPDATE
        SET policy = ${JSON.stringify(policy)}::jsonb,
            updated_at = NOW()
    `;

    return c.json({
      success: true,
      agentId,
      policy,
      message: 'Spending policy applied. All future payment intents for this agent will be validated against it.',
      _schema: 'SpendingPolicy/1.0',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/agents/:agentId/policy
// ---------------------------------------------------------------------------

router.delete('/', async (c) => {
  const agentId = c.req.param('agentId');
  const agentKey = c.req.header('x-agent-key') ?? c.req.header('X-Agent-Key');
  const adminKey = c.req.header('x-admin-key') ?? c.req.header('X-Admin-Key');

  const sql = createDb(c.env);
  try {
    if (!(await isAuthorized(sql, agentId, agentKey, adminKey, c.env.ADMIN_SECRET_KEY))) {
      return c.json({ error: 'UNAUTHORIZED — provide X-Agent-Key or X-Admin-Key' }, 401);
    }

    await sql`DELETE FROM agent_spending_policies WHERE agent_id = ${agentId}`.catch(() => {});

    return c.json({
      success: true,
      agentId,
      message: 'Spending policy removed. Agent has no spending restrictions.',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

export { router as spendingPoliciesRouter };

// ─── Policy enforcement helper (imported by v1Intents + marketplace/hire) ──
//
// Returns null if allowed, or an error object if blocked.
//
export async function enforceSpendingPolicy(
  sql: ReturnType<typeof createDb>,
  agentId: string,
  amountUsdc: number,
  recipientAgentId?: string,
  recipientCategory?: string,
): Promise<{ blocked: true; reason: string; code: string } | null> {
  const rows = await sql<any[]>`
    SELECT policy FROM agent_spending_policies WHERE agent_id = ${agentId} LIMIT 1
  `.catch(() => []);

  if (!rows.length || !rows[0].policy) return null;
  const p = parseJsonb(rows[0].policy, null as any);
  if (!p) return null;

  if (p.enabled === false) {
    return { blocked: true, reason: 'Agent spending is disabled by policy.', code: 'POLICY_DISABLED' };
  }

  if (p.pausedUntil && new Date(p.pausedUntil) > new Date()) {
    return { blocked: true, reason: `Spending paused until ${p.pausedUntil}.`, code: 'POLICY_PAUSED' };
  }

  if (p.maxSinglePaymentUsdc !== null && amountUsdc > p.maxSinglePaymentUsdc) {
    return {
      blocked: true,
      reason: `Payment of ${amountUsdc} USDC exceeds single-payment limit of ${p.maxSinglePaymentUsdc} USDC.`,
      code: 'EXCEEDS_SINGLE_LIMIT',
    };
  }

  if (p.blockedRecipients?.length && recipientAgentId && p.blockedRecipients.includes(recipientAgentId)) {
    return { blocked: true, reason: `Recipient ${recipientAgentId} is blocked by policy.`, code: 'RECIPIENT_BLOCKED' };
  }

  if (p.allowedRecipients?.length && recipientAgentId && !p.allowedRecipients.includes(recipientAgentId)) {
    return { blocked: true, reason: `Recipient ${recipientAgentId} is not on the allowed list.`, code: 'RECIPIENT_NOT_ALLOWED' };
  }

  if (p.allowedCategories?.length && recipientCategory && !p.allowedCategories.includes(recipientCategory)) {
    return { blocked: true, reason: `Category '${recipientCategory}' is not in the allowed categories list.`, code: 'CATEGORY_NOT_ALLOWED' };
  }

  // Daily + monthly caps require spending history query — best-effort
  if (p.maxDailyUsdc !== null) {
    const dailyRows = await sql<any[]>`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM payment_intents
      WHERE agent_id = ${agentId}
        AND status IN ('completed','confirmed','wallet_spend')
        AND created_at >= NOW() - INTERVAL '24 hours'
    `.catch(() => []);
    const dailySpent = Number(dailyRows[0]?.total ?? 0);
    if (dailySpent + amountUsdc > p.maxDailyUsdc) {
      return {
        blocked: true,
        reason: `Daily limit of ${p.maxDailyUsdc} USDC would be exceeded (already spent ${dailySpent.toFixed(2)} USDC today).`,
        code: 'EXCEEDS_DAILY_LIMIT',
      };
    }
  }

  if (p.maxMonthlyUsdc !== null) {
    const monthlyRows = await sql<any[]>`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM payment_intents
      WHERE agent_id = ${agentId}
        AND status IN ('completed','confirmed','wallet_spend')
        AND date_trunc('month', created_at) = date_trunc('month', NOW())
    `.catch(() => []);
    const monthlySpent = Number(monthlyRows[0]?.total ?? 0);
    if (monthlySpent + amountUsdc > p.maxMonthlyUsdc) {
      return {
        blocked: true,
        reason: `Monthly limit of ${p.maxMonthlyUsdc} USDC would be exceeded (already spent ${monthlySpent.toFixed(2)} USDC this month).`,
        code: 'EXCEEDS_MONTHLY_LIMIT',
      };
    }
  }

  return null;
}
