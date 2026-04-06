/**
 * Ace — GET /ace/journeys/:id
 *
 * Returns the current state of a live journey session.
 * Supports polling; SSE / webhook delivery is wired in subsequent phases.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { createDb } from '../../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /ace/journeys/:id
router.get('/', async (c) => {
  const sessionId = c.req.param('id');

  const sql = createDb(c.env);
  try {
    const rows = await sql<{
      id: string;
      trip_intent_id: string;
      principal_id: string;
      operator_id: string;
      policy_id: string;
      approval_id: string;
      initiated_by: string;
      booking_state: string;
      live_state: {
        departureTime?: string;
        arrivalTime?: string;
        platform?: string;
        gate?: string;
        disruption?: string;
        rerouteOptions?: { summary: string; totalAmountGbp: number; approvalRequired: boolean }[];
      } | null;
      notifications: string[];
      created_at: string;
      updated_at: string;
    }[]>`
      SELECT id, trip_intent_id, principal_id, operator_id, policy_id, approval_id,
             initiated_by, booking_state, live_state, notifications, created_at, updated_at
      FROM ace_journey_sessions
      WHERE id = ${sessionId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return c.json({ error: 'Journey session not found' }, 404);
    }

    const row = rows[0];

    // Load operator name for display
    const operators = await sql<{ name: string }[]>`
      SELECT name FROM ace_operators WHERE id = ${row.operator_id} LIMIT 1
    `;
    const operatorName = operators[0]?.name ?? row.operator_id;

    const liveState = row.live_state ?? {};

    return c.json({
      journeyId: row.id,
      tripIntentId: row.trip_intent_id,
      bookingState: row.booking_state,
      initiatedBy: row.initiated_by,
      operatorName,
      policyUsed: row.policy_id,
      approvalId: row.approval_id,
      liveState: {
        departureTime: liveState.departureTime,
        arrivalTime: liveState.arrivalTime,
        platform: liveState.platform,
        gate: liveState.gate,
        disruption: liveState.disruption,
      },
      rerouteOptions: liveState.rerouteOptions ?? [],
      notifications: row.notifications ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } finally {
    await sql.end();
  }
});

// PATCH /ace/journeys/:id/live — update live state (internal, called by platform watchers)
router.patch('/live', async (c) => {
  const sessionId = c.req.param('id');

  // Require admin key for live state updates
  const adminKey = c.req.header('x-admin-key');
  if (!adminKey || adminKey !== c.env.ADMIN_SECRET_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{
    bookingState?: string;
    liveState?: {
      departureTime?: string;
      arrivalTime?: string;
      platform?: string;
      gate?: string;
      disruption?: string;
      rerouteOptions?: { summary: string; totalAmountGbp: number; approvalRequired: boolean }[];
    };
  }>();

  const sql = createDb(c.env);
  try {
    if (body.bookingState) {
      await sql`
        UPDATE ace_journey_sessions
        SET booking_state = ${body.bookingState}, updated_at = now()
        WHERE id = ${sessionId}
      `;
    }

    if (body.liveState) {
      await sql`
        UPDATE ace_journey_sessions
        SET live_state = ${JSON.stringify(body.liveState)}::jsonb, updated_at = now()
        WHERE id = ${sessionId}
      `;
    }

    return c.json({ updated: true });
  } finally {
    await sql.end();
  }
});

export { router as aceJourneysRouter };
