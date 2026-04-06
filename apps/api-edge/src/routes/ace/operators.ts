/**
 * Ace — /ace/operators
 *
 * POST /ace/operators       — register a trusted operator for a principal
 * GET  /ace/operators/:id   — get operator details
 * DELETE /ace/operators/:id — revoke an operator
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { createDb } from '../../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

const VALID_OPERATOR_TYPES = ['human', 'personal_agent', 'specialist_agent', 'household_operator'];
const VALID_ACTIONS = ['plan', 'book_rail', 'book_flight', 'book_hotel', 'cancel', 'reroute'];

function genId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

// POST /ace/operators
router.post('/', async (c) => {
  const body = await c.req.json<{
    principalId?: string;
    operatorType?: string;
    name?: string;
    allowedActions?: string[];
    spendLimitGbp?: number;
    requiresHumanConfirmAboveGbp?: number;
    expiresAt?: string;
  }>();

  const { principalId, operatorType, name, allowedActions = [], spendLimitGbp, requiresHumanConfirmAboveGbp, expiresAt } = body;

  if (!principalId || !operatorType || !name) {
    return c.json({ error: 'principalId, operatorType, and name are required' }, 400);
  }

  if (!VALID_OPERATOR_TYPES.includes(operatorType)) {
    return c.json(
      { error: `operatorType must be one of: ${VALID_OPERATOR_TYPES.join(', ')}` },
      400,
    );
  }

  const validActions = allowedActions.filter((a) => VALID_ACTIONS.includes(a));

  const operatorId = genId('opr');
  const permissionsId = genId('prm');

  const sql = createDb(c.env);
  try {
    await sql`
      INSERT INTO ace_operators
        (id, principal_id, operator_type, name, permissions_id, allowed_actions,
         spend_limit_gbp, requires_human_confirm_above_gbp, delegation_expires_at, created_at)
      VALUES (
        ${operatorId}, ${principalId}, ${operatorType}, ${name}, ${permissionsId},
        ${validActions}::text[],
        ${spendLimitGbp ?? null},
        ${requiresHumanConfirmAboveGbp ?? null},
        ${expiresAt ?? null},
        now()
      )
    `;

    // Add operator to principal's trusted list
    await sql`
      UPDATE ace_principals
      SET trusted_operator_ids = array_append(trusted_operator_ids, ${operatorId}),
          updated_at = now()
      WHERE id = ${principalId}
    `;

    return c.json({ operatorId, permissionsId }, 201);
  } finally {
    await sql.end();
  }
});

// GET /ace/operators/:id
router.get('/:id', async (c) => {
  const operatorId = c.req.param('id');

  const sql = createDb(c.env);
  try {
    const rows = await sql<{
      id: string;
      principal_id: string;
      operator_type: string;
      name: string;
      permissions_id: string;
      allowed_actions: string[];
      spend_limit_gbp: number | null;
      requires_human_confirm_above_gbp: number | null;
      delegation_expires_at: string | null;
      revoked_at: string | null;
      created_at: string;
    }[]>`
      SELECT id, principal_id, operator_type, name, permissions_id, allowed_actions,
             spend_limit_gbp, requires_human_confirm_above_gbp, delegation_expires_at,
             revoked_at, created_at
      FROM ace_operators
      WHERE id = ${operatorId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return c.json({ error: 'Operator not found' }, 404);
    }

    const row = rows[0];
    const isActive = !row.revoked_at &&
      (!row.delegation_expires_at || new Date(row.delegation_expires_at) > new Date());

    return c.json({
      operatorId: row.id,
      principalId: row.principal_id,
      type: row.operator_type,
      name: row.name,
      permissionsId: row.permissions_id,
      allowedActions: row.allowed_actions,
      spendLimitGbp: row.spend_limit_gbp,
      requiresHumanConfirmAboveGbp: row.requires_human_confirm_above_gbp,
      delegationExpiresAt: row.delegation_expires_at,
      revokedAt: row.revoked_at,
      isActive,
      createdAt: row.created_at,
    });
  } finally {
    await sql.end();
  }
});

// DELETE /ace/operators/:id — revoke
router.delete('/:id', async (c) => {
  const operatorId = c.req.param('id');

  const sql = createDb(c.env);
  try {
    const updated = await sql<{ id: string }[]>`
      UPDATE ace_operators
      SET revoked_at = now()
      WHERE id = ${operatorId} AND revoked_at IS NULL
      RETURNING id
    `;

    if (updated.length === 0) {
      return c.json({ error: 'Operator not found or already revoked' }, 404);
    }

    return c.json({ operatorId, revokedAt: new Date().toISOString() });
  } finally {
    await sql.end();
  }
});

export { router as aceOperatorsRouter };
