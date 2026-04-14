/**
 * Spending Policies - /api/v1/agents/:agentId/policy
 *
 * Per-agent spending controls for enterprise deployments.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb, parseJsonb } from '../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

interface AgentPolicyRow {
  policy: unknown;
}

interface AgentIdentityRow {
  metadata: unknown;
}

type PolicyBlock = { blocked: true; reason: string; code: string };

async function attempt<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function isAuthorized(
  sql: ReturnType<typeof createDb>,
  agentId: string,
  agentKey: string | undefined,
  adminKey: string | undefined,
  envAdminKey: string | undefined,
): Promise<boolean> {
  if (adminKey && envAdminKey && adminKey === envAdminKey) return true;
  if (!agentKey) return false;

  const keyHash = await sha256(agentKey);
  const rows = await attempt(
    () => sql<AgentIdentityRow[]>`
      SELECT metadata FROM agent_identities WHERE agent_id = ${agentId} LIMIT 1
    `,
    [] as AgentIdentityRow[],
  );
  const meta = parseJsonb<Record<string, unknown>>(rows[0]?.metadata, {});
  return rows.length > 0 && meta.agentKeyHash === keyHash;
}

const POLICY_DEFAULTS = {
  maxSinglePaymentUsdc: null,
  maxDailyUsdc: null,
  maxMonthlyUsdc: null,
  allowedRecipients: null,
  blockedRecipients: null,
  requireApprovalAbove: null,
  allowedCategories: null,
  pausedUntil: null,
  enabled: true,
};

function validatePolicy(policy: Record<string, unknown>): string | null {
  const numFields = [
    'maxSinglePaymentUsdc',
    'maxDailyUsdc',
    'maxMonthlyUsdc',
    'requireApprovalAbove',
  ];
  for (const field of numFields) {
    if (
      policy[field] !== undefined &&
      policy[field] !== null &&
      (typeof policy[field] !== 'number' || (policy[field] as number) <= 0)
    ) {
      return `${field} must be a positive number or null`;
    }
  }

  const arrFields = ['allowedRecipients', 'blockedRecipients', 'allowedCategories'];
  for (const field of arrFields) {
    if (policy[field] !== undefined && policy[field] !== null && !Array.isArray(policy[field])) {
      return `${field} must be an array or null`;
    }
  }

  if (policy.pausedUntil !== undefined && policy.pausedUntil !== null) {
    if (
      typeof policy.pausedUntil !== 'string' ||
      Number.isNaN(Date.parse(policy.pausedUntil as string))
    ) {
      return 'pausedUntil must be an ISO timestamp string or null';
    }
  }

  if (policy.enabled !== undefined && typeof policy.enabled !== 'boolean') {
    return 'enabled must be a boolean';
  }

  return null;
}

router.get('/', async (c) => {
  const agentId = c.req.param('agentId');
  if (!agentId) return c.json({ error: 'agentId required' }, 400);

  const sql = createDb(c.env);
  try {
    const rows = await attempt(
      () => sql<AgentPolicyRow[]>`
        SELECT policy FROM agent_spending_policies WHERE agent_id = ${agentId} LIMIT 1
      `,
      [] as AgentPolicyRow[],
    );

    if (rows.length === 0) {
      return c.json({
        success: true,
        agentId,
        policy: null,
        message: 'No policy set - agent has no spending restrictions.',
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

router.put('/', async (c) => {
  const agentId = c.req.param('agentId');
  if (!agentId) return c.json({ error: 'agentId required' }, 400);

  const agentKey = c.req.header('x-agent-key') ?? c.req.header('X-Agent-Key');
  const adminKey = c.req.header('x-admin-key') ?? c.req.header('X-Admin-Key');

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const sql = createDb(c.env);
  try {
    if (!(await isAuthorized(sql, agentId, agentKey, adminKey, c.env.ADMIN_SECRET_KEY))) {
      return c.json({ error: 'UNAUTHORIZED - provide X-Agent-Key or X-Admin-Key' }, 401);
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
      message:
        'Spending policy applied. All future payment intents for this agent will be validated against it.',
      _schema: 'SpendingPolicy/1.0',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

router.delete('/', async (c) => {
  const agentId = c.req.param('agentId');
  if (!agentId) return c.json({ error: 'agentId required' }, 400);

  const agentKey = c.req.header('x-agent-key') ?? c.req.header('X-Agent-Key');
  const adminKey = c.req.header('x-admin-key') ?? c.req.header('X-Admin-Key');

  const sql = createDb(c.env);
  try {
    if (!(await isAuthorized(sql, agentId, agentKey, adminKey, c.env.ADMIN_SECRET_KEY))) {
      return c.json({ error: 'UNAUTHORIZED - provide X-Agent-Key or X-Admin-Key' }, 401);
    }

    await sql`DELETE FROM agent_spending_policies WHERE agent_id = ${agentId}`;

    return c.json({
      success: true,
      agentId,
      message: 'Spending policy removed. Agent has no spending restrictions.',
    });
  } catch (err) {
    console.error(
      '[spending-policies] DELETE /api/v1/agents/:agentId/policy error:',
      err instanceof Error ? err.message : err,
    );
    return c.json({ error: 'Failed to remove spending policy' }, 500);
  } finally {
    await sql.end().catch(() => {});
  }
});

export { router as spendingPoliciesRouter };

export async function enforceSpendingPolicy(
  sql: ReturnType<typeof createDb>,
  agentId: string,
  amountUsdc: number,
  recipientAgentId?: string,
  recipientCategory?: string,
): Promise<PolicyBlock | null> {
  const rows = await sql<AgentPolicyRow[]>`
    SELECT policy FROM agent_spending_policies WHERE agent_id = ${agentId} LIMIT 1
  `;

  if (rows.length === 0 || !rows[0].policy) return null;
  const policy = parseJsonb<Record<string, any> | null>(rows[0].policy, null);
  if (!policy) return null;

  if (policy.enabled === false) {
    return { blocked: true, reason: 'Agent spending is disabled by policy.', code: 'POLICY_DISABLED' };
  }

  if (policy.pausedUntil && new Date(policy.pausedUntil) > new Date()) {
    return {
      blocked: true,
      reason: `Spending paused until ${policy.pausedUntil}.`,
      code: 'POLICY_PAUSED',
    };
  }

  if (policy.maxSinglePaymentUsdc !== null && amountUsdc > policy.maxSinglePaymentUsdc) {
    return {
      blocked: true,
      reason: `Payment of ${amountUsdc} USDC exceeds single-payment limit of ${policy.maxSinglePaymentUsdc} USDC.`,
      code: 'EXCEEDS_SINGLE_LIMIT',
    };
  }

  if (
    policy.blockedRecipients?.length &&
    recipientAgentId &&
    policy.blockedRecipients.includes(recipientAgentId)
  ) {
    return {
      blocked: true,
      reason: `Recipient ${recipientAgentId} is blocked by policy.`,
      code: 'RECIPIENT_BLOCKED',
    };
  }

  if (
    policy.allowedRecipients?.length &&
    recipientAgentId &&
    !policy.allowedRecipients.includes(recipientAgentId)
  ) {
    return {
      blocked: true,
      reason: `Recipient ${recipientAgentId} is not on the allowed list.`,
      code: 'RECIPIENT_NOT_ALLOWED',
    };
  }

  if (
    policy.allowedCategories?.length &&
    recipientCategory &&
    !policy.allowedCategories.includes(recipientCategory)
  ) {
    return {
      blocked: true,
      reason: `Category '${recipientCategory}' is not in the allowed categories list.`,
      code: 'CATEGORY_NOT_ALLOWED',
    };
  }

  if (policy.maxDailyUsdc !== null) {
    const dailyRows = await sql<Array<{ total: number | string }>>`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM payment_intents
      WHERE agent_id = ${agentId}
        AND status IN ('completed','confirmed','wallet_spend')
        AND created_at >= NOW() - INTERVAL '24 hours'
    `;
    const dailySpent = Number(dailyRows[0]?.total ?? 0);
    if (dailySpent + amountUsdc > policy.maxDailyUsdc) {
      return {
        blocked: true,
        reason: `Daily limit of ${policy.maxDailyUsdc} USDC would be exceeded (already spent ${dailySpent.toFixed(2)} USDC today).`,
        code: 'EXCEEDS_DAILY_LIMIT',
      };
    }
  }

  if (policy.maxMonthlyUsdc !== null) {
    const monthlyRows = await sql<Array<{ total: number | string }>>`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM payment_intents
      WHERE agent_id = ${agentId}
        AND status IN ('completed','confirmed','wallet_spend')
        AND date_trunc('month', created_at) = date_trunc('month', NOW())
    `;
    const monthlySpent = Number(monthlyRows[0]?.total ?? 0);
    if (monthlySpent + amountUsdc > policy.maxMonthlyUsdc) {
      return {
        blocked: true,
        reason: `Monthly limit of ${policy.maxMonthlyUsdc} USDC would be exceeded (already spent ${monthlySpent.toFixed(2)} USDC this month).`,
        code: 'EXCEEDS_MONTHLY_LIMIT',
      };
    }
  }

  return null;
}
