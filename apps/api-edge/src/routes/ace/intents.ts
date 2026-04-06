/**
 * Ace — /ace/intents
 *
 * POST /ace/intents         — submit a trip intent (human or delegated agent)
 * GET  /ace/intents/:id     — get intent status and current state
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { createDb } from '../../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

function genId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

// POST /ace/intents
router.post('/', async (c) => {
  const body = await c.req.json<{
    principalId?: string;
    operatorId?: string;
    objective?: string;
    constraints?: {
      latestArrival?: string;
      budgetMax?: number;
      preferredModes?: string[];
      avoidModes?: string[];
      passengerCount?: number;
    };
  }>();

  const { principalId, operatorId, objective, constraints } = body;

  if (!principalId || !operatorId || !objective) {
    return c.json({ error: 'principalId, operatorId, and objective are required' }, 400);
  }

  // Determine source: if operatorId matches principalId's own agent, treat as direct_human
  // For now, delegate that logic to the caller via a flag; default to delegated_agent
  const source = principalId === operatorId ? 'direct_human' : 'delegated_agent';

  const intentId = genId('int');
  const now = new Date().toISOString();

  const sql = createDb(c.env);
  try {
    await sql`
      INSERT INTO ace_trip_intents
        (id, principal_id, operator_id, source, objective, constraints, status, created_at, updated_at)
      VALUES
        (${intentId}, ${principalId}, ${operatorId}, ${source}, ${objective},
         ${JSON.stringify(constraints ?? {})}::jsonb, 'draft', now(), now())
    `;
  } finally {
    await sql.end();
  }

  return c.json({ intentId, status: 'draft', createdAt: now }, 201);
});

// GET /ace/intents/:id
router.get('/:id', async (c) => {
  const id = c.req.param('id');

  const sql = createDb(c.env);
  try {
    const rows = await sql<{
      id: string;
      principal_id: string;
      operator_id: string;
      source: string;
      objective: string;
      constraints: unknown;
      status: string;
      plan_id: string | null;
      journey_session_id: string | null;
      created_at: string;
      updated_at: string;
    }[]>`
      SELECT id, principal_id, operator_id, source, objective, constraints,
             status, plan_id, journey_session_id, created_at, updated_at
      FROM ace_trip_intents
      WHERE id = ${id}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return c.json({ error: 'Intent not found' }, 404);
    }

    const row = rows[0];
    return c.json({
      intentId: row.id,
      principalId: row.principal_id,
      operatorId: row.operator_id,
      source: row.source,
      objective: row.objective,
      constraints: row.constraints,
      status: row.status,
      planId: row.plan_id,
      journeySessionId: row.journey_session_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } finally {
    await sql.end();
  }
});

export { router as aceIntentsRouter };
