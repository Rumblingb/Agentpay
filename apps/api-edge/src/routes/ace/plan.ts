/**
 * Ace — POST /ace/intents/:id/plan
 *
 * Runs the policy engine against the intent to produce:
 *   - a recommendation summary
 *   - the approval gate required (auto | human_confirm | escalate)
 *
 * The actual transport search (RTT, Duffel, etc.) is handled by the
 * concierge route; this route provides the policy decision layer.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { createDb } from '../../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

type PolicyDecisionMode = 'auto' | 'human_confirm' | 'escalate';

function evaluatePolicy(params: {
  modes: string[];
  budgetGbp: number | null;
  autoBookRailUnderGbp: number | null;
  requireHumanForFlights: boolean;
}): { mode: PolicyDecisionMode; reason: string; code?: string } {
  const { modes, budgetGbp, autoBookRailUnderGbp, requireHumanForFlights } = params;

  if (modes.includes('flight') && requireHumanForFlights) {
    return { mode: 'human_confirm', reason: 'Flight bookings always require your confirmation.' };
  }

  if (
    (modes.length === 0 || modes.includes('rail')) &&
    autoBookRailUnderGbp != null &&
    budgetGbp != null &&
    budgetGbp <= autoBookRailUnderGbp
  ) {
    return {
      mode: 'auto',
      reason: `Rail booking within your £${autoBookRailUnderGbp} auto-book limit.`,
    };
  }

  if (autoBookRailUnderGbp != null && budgetGbp != null && budgetGbp > autoBookRailUnderGbp) {
    return {
      mode: 'human_confirm',
      reason: `Cost exceeds your £${autoBookRailUnderGbp} auto-book limit.`,
    };
  }

  return { mode: 'human_confirm', reason: 'No auto-book policy configured for this trip type.' };
}

// POST /ace/intents/:id/plan
router.post('/', async (c) => {
  const intentId = c.req.param('id');

  const sql = createDb(c.env);
  try {
    // Load intent
    const intents = await sql<{
      id: string;
      principal_id: string;
      objective: string;
      constraints: { preferredModes?: string[]; budgetMax?: number } | null;
      status: string;
    }[]>`
      SELECT id, principal_id, objective, constraints, status
      FROM ace_trip_intents
      WHERE id = ${intentId}
      LIMIT 1
    `;

    if (intents.length === 0) {
      return c.json({ error: 'Intent not found' }, 404);
    }

    const intent = intents[0];

    if (intent.status !== 'draft') {
      return c.json({ error: `Intent is already in status '${intent.status}'` }, 409);
    }

    // Load principal's travel policy
    const policies = await sql<{
      id: string;
      auto_book_rail_under_gbp: number | null;
      require_human_for_flights: boolean;
    }[]>`
      SELECT id, auto_book_rail_under_gbp, require_human_for_flights
      FROM ace_travel_policies
      WHERE principal_id = ${intent.principal_id}
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    const policy = policies[0] ?? null;
    const constraints = intent.constraints ?? {};
    const modes: string[] = constraints.preferredModes ?? [];
    const budgetGbp = constraints.budgetMax != null ? constraints.budgetMax / 100 : null;

    const decision = evaluatePolicy({
      modes,
      budgetGbp,
      autoBookRailUnderGbp: policy?.auto_book_rail_under_gbp ?? null,
      requireHumanForFlights: policy?.require_human_for_flights ?? true,
    });

    const newStatus = decision.mode === 'auto' ? 'planned' : 'awaiting_approval';

    // Update intent status and store plan reference
    const planId = `pln_${Date.now().toString(36)}`;
    await sql`
      UPDATE ace_trip_intents
      SET status = ${newStatus}, plan_id = ${planId}, updated_at = now()
      WHERE id = ${intentId}
    `;

    // Create approval record
    const approvalId = `apv_${Date.now().toString(36)}`;
    const requiredFrom = decision.mode === 'auto' ? 'policy_auto' : 'human';
    const approvalStatus = decision.mode === 'auto' ? 'approved' : 'pending';

    await sql`
      INSERT INTO ace_approvals
        (id, trip_intent_id, required_from, reason, status, decided_at, created_at)
      VALUES (
        ${approvalId}, ${intentId}, ${requiredFrom}, ${decision.reason},
        ${approvalStatus},
        ${decision.mode === 'auto' ? new Date().toISOString() : null},
        now()
      )
    `;

    return c.json({
      status: newStatus,
      planId,
      recommendation: {
        summary: intent.objective,
        totalAmountGbp: budgetGbp ?? 0,
        legs: [],
      },
      approval: {
        approvalId,
        mode: decision.mode,
        requiredFrom,
        reason: decision.reason,
      },
    });
  } finally {
    await sql.end();
  }
});

export { router as acePlanRouter };
