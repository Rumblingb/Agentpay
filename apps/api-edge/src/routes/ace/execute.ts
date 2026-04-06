/**
 * Ace — POST /ace/intents/:id/execute
 *
 * Triggers booking + payment for an approved intent.
 * Creates a JourneySession as the live object Ace owns.
 *
 * Only intents in 'approved' status may be executed.
 * Actual booking adapter calls are wired in subsequent phases.
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

// POST /ace/intents/:id/execute
router.post('/', async (c) => {
  const intentId = c.req.param('id');

  const sql = createDb(c.env);
  try {
    // Load intent
    const intents = await sql<{
      id: string;
      principal_id: string;
      operator_id: string;
      source: string;
      status: string;
    }[]>`
      SELECT id, principal_id, operator_id, source, status
      FROM ace_trip_intents
      WHERE id = ${intentId}
      LIMIT 1
    `;

    if (intents.length === 0) {
      return c.json({ error: 'Intent not found' }, 404);
    }

    const intent = intents[0];

    if (intent.status !== 'approved') {
      return c.json(
        { error: `Intent is in status '${intent.status}'; only approved intents can be executed` },
        409,
      );
    }

    // Load the approved approval record
    const approvals = await sql<{ id: string; required_from: string }[]>`
      SELECT id, required_from
      FROM ace_approvals
      WHERE trip_intent_id = ${intentId} AND status = 'approved'
      ORDER BY decided_at DESC
      LIMIT 1
    `;

    if (approvals.length === 0) {
      return c.json({ error: 'No approved approval record found for this intent' }, 409);
    }

    const approval = approvals[0];

    // Load policy ID for this principal
    const policies = await sql<{ id: string }[]>`
      SELECT id FROM ace_travel_policies
      WHERE principal_id = ${intent.principal_id}
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    const policyId = policies[0]?.id ?? 'pol_default';

    // Create journey session
    const sessionId = genId('jrn');
    const initiatedBy = intent.source === 'direct_human' ? 'human' : 'agent';

    await sql`
      INSERT INTO ace_journey_sessions
        (id, trip_intent_id, principal_id, operator_id, policy_id, approval_id,
         initiated_by, booking_state, live_state, notifications, created_at, updated_at)
      VALUES
        (${sessionId}, ${intentId}, ${intent.principal_id}, ${intent.operator_id},
         ${policyId}, ${approval.id}, ${initiatedBy}, 'planned',
         '{}'::jsonb, '{}'::text[], now(), now())
    `;

    // Update intent to executing state
    await sql`
      UPDATE ace_trip_intents
      SET status = 'executing', journey_session_id = ${sessionId}, updated_at = now()
      WHERE id = ${intentId}
    `;

    return c.json({ journeySessionId: sessionId, status: 'executing' }, 202);
  } finally {
    await sql.end();
  }
});

export { router as aceExecuteRouter };
