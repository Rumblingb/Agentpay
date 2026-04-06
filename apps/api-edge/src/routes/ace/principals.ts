/**
 * Ace — /ace/principals
 *
 * GET   /ace/principals/:id          — get principal record
 * POST  /ace/principals              — create a principal (links to agent_identity)
 * GET   /ace/principals/:id/policy   — get principal's travel policy
 * PATCH /ace/principals/:id/policy   — update principal's travel policy
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

// POST /ace/principals — create a principal
router.post('/', async (c) => {
  const body = await c.req.json<{
    agentId?: string;
    name?: string;
    profileId?: string;
  }>();

  const { agentId, name, profileId } = body;

  if (!agentId) {
    return c.json({ error: 'agentId is required' }, 400);
  }

  const principalId = genId('usr');
  const policyId = genId('pol');

  const sql = createDb(c.env);
  try {
    // Create principal
    await sql`
      INSERT INTO ace_principals
        (id, agent_id, profile_id, policy_set_id, trusted_operator_ids, created_at, updated_at)
      VALUES
        (${principalId}, ${agentId}, ${profileId ?? null}, ${policyId}, '{}', now(), now())
    `;

    // Create default travel policy
    await sql`
      INSERT INTO ace_travel_policies
        (id, principal_id, require_human_for_flights, prefer_direct,
         preferred_seat, preferred_class, operator_permissions, updated_at)
      VALUES
        (${policyId}, ${principalId}, true, true, 'any', 'standard', '[]'::jsonb, now())
    `;

    return c.json({ principalId, policyId }, 201);
  } finally {
    await sql.end();
  }
});

// GET /ace/principals/:id
router.get('/:id', async (c) => {
  const principalId = c.req.param('id');

  const sql = createDb(c.env);
  try {
    const rows = await sql<{
      id: string;
      agent_id: string | null;
      profile_id: string | null;
      policy_set_id: string | null;
      trusted_operator_ids: string[];
      created_at: string;
      updated_at: string;
    }[]>`
      SELECT id, agent_id, profile_id, policy_set_id, trusted_operator_ids, created_at, updated_at
      FROM ace_principals
      WHERE id = ${principalId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return c.json({ error: 'Principal not found' }, 404);
    }

    const row = rows[0];
    return c.json({
      principalId: row.id,
      agentId: row.agent_id,
      profileId: row.profile_id,
      policySetId: row.policy_set_id,
      trustedOperatorIds: row.trusted_operator_ids ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } finally {
    await sql.end();
  }
});

// GET /ace/principals/:id/policy
router.get('/:id/policy', async (c) => {
  const principalId = c.req.param('id');

  const sql = createDb(c.env);
  try {
    const rows = await sql<{
      id: string;
      auto_book_rail_under_gbp: number | null;
      auto_book_hotel_under_gbp: number | null;
      require_human_for_flights: boolean;
      max_arrival_hour: number | null;
      prefer_direct: boolean;
      preferred_seat: string | null;
      preferred_class: string | null;
      business_class_flights_over_hours: number | null;
      operator_permissions: unknown;
      updated_at: string;
    }[]>`
      SELECT id, auto_book_rail_under_gbp, auto_book_hotel_under_gbp,
             require_human_for_flights, max_arrival_hour, prefer_direct,
             preferred_seat, preferred_class, business_class_flights_over_hours,
             operator_permissions, updated_at
      FROM ace_travel_policies
      WHERE principal_id = ${principalId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      return c.json({ error: 'No policy found for this principal' }, 404);
    }

    const row = rows[0];
    return c.json({
      policyId: row.id,
      principalId,
      autoBookRailUnderGbp: row.auto_book_rail_under_gbp,
      autoBookHotelUnderGbp: row.auto_book_hotel_under_gbp,
      requireHumanApprovalForFlights: row.require_human_for_flights,
      maxArrivalHour: row.max_arrival_hour,
      preferDirect: row.prefer_direct,
      preferredSeat: row.preferred_seat,
      preferredClass: row.preferred_class,
      businessClassFlightsOverHours: row.business_class_flights_over_hours,
      operatorPermissions: row.operator_permissions ?? [],
      updatedAt: row.updated_at,
    });
  } finally {
    await sql.end();
  }
});

// PATCH /ace/principals/:id/policy
router.patch('/:id/policy', async (c) => {
  const principalId = c.req.param('id');

  const body = await c.req.json<{
    autoBookRailUnderGbp?: number | null;
    autoBookHotelUnderGbp?: number | null;
    requireHumanApprovalForFlights?: boolean;
    maxArrivalHour?: number | null;
    preferDirect?: boolean;
    preferredSeat?: 'window' | 'aisle' | 'any';
    preferredClass?: 'standard' | 'first';
    businessClassFlightsOverHours?: number | null;
    operatorPermissions?: unknown[];
  }>();

  const sql = createDb(c.env);
  try {
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM ace_travel_policies
      WHERE principal_id = ${principalId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    if (existing.length === 0) {
      return c.json({ error: 'No policy found for this principal' }, 404);
    }

    const policyId = existing[0].id;

    await sql`
      UPDATE ace_travel_policies SET
        auto_book_rail_under_gbp = COALESCE(${body.autoBookRailUnderGbp ?? null}, auto_book_rail_under_gbp),
        auto_book_hotel_under_gbp = COALESCE(${body.autoBookHotelUnderGbp ?? null}, auto_book_hotel_under_gbp),
        require_human_for_flights = COALESCE(${body.requireHumanApprovalForFlights ?? null}, require_human_for_flights),
        max_arrival_hour = COALESCE(${body.maxArrivalHour ?? null}, max_arrival_hour),
        prefer_direct = COALESCE(${body.preferDirect ?? null}, prefer_direct),
        preferred_seat = COALESCE(${body.preferredSeat ?? null}, preferred_seat),
        preferred_class = COALESCE(${body.preferredClass ?? null}, preferred_class),
        business_class_flights_over_hours = COALESCE(${body.businessClassFlightsOverHours ?? null}, business_class_flights_over_hours),
        operator_permissions = COALESCE(${body.operatorPermissions ? JSON.stringify(body.operatorPermissions) : null}::jsonb, operator_permissions),
        updated_at = now()
      WHERE id = ${policyId}
    `;

    return c.json({ policyId, updated: true });
  } finally {
    await sql.end();
  }
});

export { router as acePrincipalsRouter };
