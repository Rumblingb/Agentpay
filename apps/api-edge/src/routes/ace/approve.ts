/**
 * Ace — POST /ace/intents/:id/approve
 *
 * Records an approval (or rejection) decision for a trip intent.
 * - policy_auto approvals are set during /plan; this endpoint handles human decisions.
 * - Only intents in 'awaiting_approval' status can be approved/rejected here.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { createDb } from '../../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// POST /ace/intents/:id/approve
router.post('/', async (c) => {
  const intentId = c.req.param('id');

  const body = await c.req.json<{
    actorId?: string;
    decision?: 'approved' | 'rejected';
    note?: string;
  }>();

  const { actorId, decision = 'approved', note } = body;

  if (!actorId) {
    return c.json({ error: 'actorId is required' }, 400);
  }

  if (decision !== 'approved' && decision !== 'rejected') {
    return c.json({ error: "decision must be 'approved' or 'rejected'" }, 400);
  }

  const sql = createDb(c.env);
  try {
    const intents = await sql<{ id: string; status: string }[]>`
      SELECT id, status FROM ace_trip_intents WHERE id = ${intentId} LIMIT 1
    `;

    if (intents.length === 0) {
      return c.json({ error: 'Intent not found' }, 404);
    }

    const intent = intents[0];

    if (intent.status !== 'awaiting_approval') {
      return c.json(
        { error: `Intent is in status '${intent.status}'; only awaiting_approval intents can be decided` },
        409,
      );
    }

    // Update the pending approval record
    const updated = await sql<{ id: string }[]>`
      UPDATE ace_approvals
      SET status = ${decision}, decided_by = ${actorId}, decided_at = now()
      WHERE trip_intent_id = ${intentId} AND status = 'pending'
      RETURNING id
    `;

    if (updated.length === 0) {
      return c.json({ error: 'No pending approval found for this intent' }, 404);
    }

    const approvalId = updated[0].id;
    const newStatus = decision === 'approved' ? 'approved' : 'draft';

    await sql`
      UPDATE ace_trip_intents
      SET status = ${newStatus}, updated_at = now()
      WHERE id = ${intentId}
    `;

    return c.json({ status: decision, approvalId, intentStatus: newStatus });
  } finally {
    await sql.end();
  }
});

export { router as aceApproveRouter };
