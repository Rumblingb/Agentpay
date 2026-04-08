/**
 * Ace Agentic Intent API — /api/ace/intents/*
 *
 * Four endpoints for the delegated TripIntent lifecycle:
 *
 *   POST   /api/ace/intents                   — Submit a TripIntent (human or agent)
 *   POST   /api/ace/intents/:intentId/plan     — Generate a stub recommendation
 *   POST   /api/ace/intents/:intentId/approve  — Approve a planned intent
 *   GET    /api/ace/intents/journeys/:intentId — Live journey state
 *
 * Auth: all routes require a valid merchant API key (authenticateApiKey).
 * No AI calls here — pure data layer. AI planning lives in the concierge route.
 *
 * ─── DB migrations required ────────────────────────────────────────────────
 *
 * Run these once against your Supabase Direct connection:
 *
 * CREATE TABLE IF NOT EXISTS ace_intents (
 *   id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
 *   principal_id      text        NOT NULL,
 *   operator_id       text        NOT NULL,
 *   source            text        NOT NULL CHECK (source IN ('direct_human', 'delegated_agent')),
 *   objective         text        NOT NULL,
 *   constraints_json  jsonb,
 *   status            text        NOT NULL DEFAULT 'draft',
 *   recommendation_json jsonb,
 *   approval_json     jsonb,
 *   actor_id          text,
 *   approved_at       timestamptz,
 *   created_at        timestamptz NOT NULL DEFAULT now(),
 *   updated_at        timestamptz NOT NULL DEFAULT now()
 * );
 *
 * CREATE INDEX IF NOT EXISTS ace_intents_principal_id_idx ON ace_intents (principal_id);
 * CREATE INDEX IF NOT EXISTS ace_intents_operator_id_idx  ON ace_intents (operator_id);
 * CREATE INDEX IF NOT EXISTS ace_intents_status_idx       ON ace_intents (status);
 *
 * CREATE TABLE IF NOT EXISTS journey_sessions (
 *   id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
 *   intent_id   uuid        NOT NULL REFERENCES ace_intents(id) ON DELETE CASCADE,
 *   status      text        NOT NULL DEFAULT 'scheduled',
 *   phase       text,
 *   live_data   jsonb,
 *   started_at  timestamptz,
 *   completed_at timestamptz,
 *   created_at  timestamptz NOT NULL DEFAULT now(),
 *   updated_at  timestamptz NOT NULL DEFAULT now()
 * );
 *
 * CREATE INDEX IF NOT EXISTS journey_sessions_intent_id_idx ON journey_sessions (intent_id);
 * ───────────────────────────────────────────────────────────────────────────
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { createDb, parseJsonb } from '../lib/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TripConstraints {
  budgetMax?: number;
  preferredModes?: string[];
  avoidModes?: string[];
  latestArrival?: string;
}

interface AceIntentRow {
  id: string;
  principal_id: string;
  operator_id: string;
  source: string;
  objective: string;
  constraints_json: unknown;
  status: string;
  recommendation_json: unknown;
  approval_json: unknown;
  actor_id: string | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface JourneySessionRow {
  id: string;
  intent_id: string;
  status: string;
  phase: string | null;
  live_data: unknown;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

router.use('*', authenticateApiKey);

// ---------------------------------------------------------------------------
// POST / — Submit a TripIntent
// ---------------------------------------------------------------------------

router.post('/', async (c) => {
  let body: {
    principalId?: unknown;
    operatorId?: unknown;
    source?: unknown;
    objective?: unknown;
    constraints?: unknown;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { principalId, operatorId, source, objective, constraints } = body;

  // Validate required fields
  if (typeof principalId !== 'string' || !principalId.trim()) {
    return c.json({ error: 'principalId is required' }, 400);
  }
  if (typeof operatorId !== 'string' || !operatorId.trim()) {
    return c.json({ error: 'operatorId is required' }, 400);
  }
  if (source !== 'direct_human' && source !== 'delegated_agent') {
    return c.json({ error: "source must be 'direct_human' or 'delegated_agent'" }, 400);
  }
  if (typeof objective !== 'string' || !objective.trim()) {
    return c.json({ error: 'objective is required' }, 400);
  }

  // Validate constraints shape if provided
  if (constraints !== undefined && constraints !== null) {
    if (typeof constraints !== 'object' || Array.isArray(constraints)) {
      return c.json({ error: 'constraints must be an object' }, 400);
    }
    const c_ = constraints as Record<string, unknown>;
    if (c_.budgetMax !== undefined && (!Number.isInteger(c_.budgetMax) || (c_.budgetMax as number) < 0)) {
      return c.json({ error: 'constraints.budgetMax must be a non-negative integer (pence/cents)' }, 400);
    }
  }

  const constraintsJson = (constraints !== undefined && constraints !== null)
    ? JSON.stringify(constraints)
    : null;

  const sql = createDb(c.env);
  try {
    const rows = await sql<Array<{ id: string; status: string; created_at: Date }>>`
      INSERT INTO ace_intents (
        principal_id,
        operator_id,
        source,
        objective,
        constraints_json
      ) VALUES (
        ${principalId.trim()},
        ${operatorId.trim()},
        ${source},
        ${objective.trim()},
        ${constraintsJson}::jsonb
      )
      RETURNING id, status, created_at
    `;

    const row = rows[0];
    return c.json({
      intentId: row.id,
      status: row.status,
      createdAt: row.created_at,
    }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[aceIntents] POST /: DB error:', msg);
    return c.json({ error: 'Failed to create intent' }, 500);
  } finally {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// POST /:intentId/plan — Generate recommendation for an intent
// ---------------------------------------------------------------------------

router.post('/:intentId/plan', async (c) => {
  const intentId = c.req.param('intentId');

  const sql = createDb(c.env);
  try {
    // Fetch the intent
    const rows = await sql<AceIntentRow[]>`
      SELECT *
      FROM ace_intents
      WHERE id = ${intentId}
    `;

    if (!rows.length) {
      return c.json({ error: 'Intent not found' }, 404);
    }

    const intent = rows[0];

    if (intent.status !== 'draft') {
      return c.json({
        error: `Intent cannot be planned in status '${intent.status}'. Expected 'draft'.`,
      }, 409);
    }

    const constraints = parseJsonb<TripConstraints>(intent.constraints_json, {});
    const budgetMax = constraints.budgetMax ?? null;

    // Stub recommendation — real AI planning happens via /api/concierge/intent
    const recommendation = {
      summary: `Ace plan for: ${intent.objective}`,
      totalAmountPence: budgetMax ?? 0,
      currency: 'GBP',
    };

    // Approval logic:
    //   - delegated_agent sources require human approval unless a policy auto-approves
    //   - direct_human sources are auto-approved by policy
    const isDelegated = intent.source === 'delegated_agent';
    const approval = isDelegated
      ? {
          requiredFrom: 'human' as const,
          reason: 'Delegated agent intents require principal confirmation before execution.',
        }
      : null;

    const newStatus = isDelegated ? 'awaiting_approval' : 'planned';

    const recommendationJson = JSON.stringify(recommendation);
    const approvalJson = approval ? JSON.stringify(approval) : null;

    await sql`
      UPDATE ace_intents
      SET
        status               = ${newStatus},
        recommendation_json  = ${recommendationJson}::jsonb,
        approval_json        = ${approvalJson}::jsonb,
        updated_at           = now()
      WHERE id = ${intentId}
    `;

    return c.json({
      intentId,
      status: newStatus,
      recommendation,
      approval,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[aceIntents] POST /:intentId/plan: DB error:', msg);
    return c.json({ error: 'Failed to plan intent' }, 500);
  } finally {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// POST /:intentId/approve — Approve a pending intent
// ---------------------------------------------------------------------------

router.post('/:intentId/approve', async (c) => {
  const intentId = c.req.param('intentId');

  let body: { actorId?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { actorId } = body;
  if (typeof actorId !== 'string' || !actorId.trim()) {
    return c.json({ error: 'actorId is required' }, 400);
  }

  const sql = createDb(c.env);
  try {
    // Fetch the intent
    const rows = await sql<Array<{ id: string; status: string }>>`
      SELECT id, status
      FROM ace_intents
      WHERE id = ${intentId}
    `;

    if (!rows.length) {
      return c.json({ error: 'Intent not found' }, 404);
    }

    const intent = rows[0];
    const approvableStatuses = ['planned', 'awaiting_approval'];

    if (!approvableStatuses.includes(intent.status)) {
      return c.json({
        error: `Intent cannot be approved in status '${intent.status}'. Expected one of: ${approvableStatuses.join(', ')}.`,
      }, 409);
    }

    const updated = await sql<Array<{ id: string; approved_at: Date }>>`
      UPDATE ace_intents
      SET
        status      = 'approved',
        actor_id    = ${actorId.trim()},
        approved_at = now(),
        updated_at  = now()
      WHERE id = ${intentId}
      RETURNING id, approved_at
    `;

    const row = updated[0];
    return c.json({
      intentId: row.id,
      status: 'approved',
      approvedAt: row.approved_at,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[aceIntents] POST /:intentId/approve: DB error:', msg);
    return c.json({ error: 'Failed to approve intent' }, 500);
  } finally {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// GET /journeys/:intentId — Live journey state
// ---------------------------------------------------------------------------

router.get('/journeys/:intentId', async (c) => {
  const intentId = c.req.param('intentId');

  const sql = createDb(c.env);
  try {
    // Verify the intent exists first
    const intentRows = await sql<Array<{ id: string; status: string }>>`
      SELECT id, status
      FROM ace_intents
      WHERE id = ${intentId}
    `;

    if (!intentRows.length) {
      return c.json({ error: 'Intent not found' }, 404);
    }

    // Fetch the most recent journey session for this intent
    const sessionRows = await sql<JourneySessionRow[]>`
      SELECT *
      FROM journey_sessions
      WHERE intent_id = ${intentId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!sessionRows.length) {
      return c.json({ error: 'No journey session found for this intent' }, 404);
    }

    const session = sessionRows[0];
    const liveData = parseJsonb<Record<string, unknown>>(session.live_data, {});

    return c.json({
      sessionId: session.id,
      intentId: session.intent_id,
      status: session.status,
      phase: session.phase,
      liveData,
      startedAt: session.started_at,
      completedAt: session.completed_at,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[aceIntents] GET /journeys/:intentId: DB error:', msg);
    return c.json({ error: 'Failed to fetch journey state' }, 500);
  } finally {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// POST /:intentId/execute — Transition approved intent to executing
// Called by the concierge when it picks up the intent and starts booking.
// ---------------------------------------------------------------------------

router.post('/:intentId/execute', async (c) => {
  const intentId = c.req.param('intentId');

  let body: { jobId?: unknown } = {};
  try { body = await c.req.json(); } catch {}

  const jobId = typeof body.jobId === 'string' && body.jobId.trim() ? body.jobId.trim() : null;

  const sql = createDb(c.env);
  try {
    const rows = await sql<Array<{ id: string; status: string }>>`
      SELECT id, status FROM ace_intents WHERE id = ${intentId}
    `;

    if (!rows.length) return c.json({ error: 'Intent not found' }, 404);

    const intent = rows[0];
    if (intent.status !== 'approved') {
      return c.json({
        error: `Intent cannot be executed in status '${intent.status}'. Expected 'approved'.`,
      }, 409);
    }

    const patch: Record<string, unknown> = { status: 'executing', updated_at: 'now()' };
    if (jobId) patch.job_id = jobId;

    await sql`
      UPDATE ace_intents
      SET
        status     = 'executing',
        updated_at = now()
        ${jobId ? sql`, actor_id = ${jobId}` : sql``}
      WHERE id = ${intentId}
    `;

    return c.json({ intentId, status: 'executing', jobId });
  } catch (err) {
    console.error('[aceIntents] POST /:intentId/execute:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to execute intent' }, 500);
  } finally {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// POST /:intentId/complete — Mark intent completed after successful booking
// ---------------------------------------------------------------------------

router.post('/:intentId/complete', async (c) => {
  const intentId = c.req.param('intentId');

  let body: { bookingRef?: unknown; ticketRef?: unknown } = {};
  try { body = await c.req.json(); } catch {}

  const sql = createDb(c.env);
  try {
    const rows = await sql<Array<{ id: string; status: string }>>`
      SELECT id, status FROM ace_intents WHERE id = ${intentId}
    `;

    if (!rows.length) return c.json({ error: 'Intent not found' }, 404);

    const intent = rows[0];
    if (!['executing', 'approved'].includes(intent.status)) {
      return c.json({
        error: `Intent cannot be completed in status '${intent.status}'.`,
      }, 409);
    }

    const completionMeta = {
      bookingRef: typeof body.bookingRef === 'string' ? body.bookingRef : null,
      ticketRef: typeof body.ticketRef === 'string' ? body.ticketRef : null,
      completedAt: new Date().toISOString(),
    };

    await sql`
      UPDATE ace_intents
      SET
        status              = 'completed',
        recommendation_json = recommendation_json || ${JSON.stringify(completionMeta)}::jsonb,
        updated_at          = now()
      WHERE id = ${intentId}
    `;

    return c.json({ intentId, status: 'completed', ...completionMeta });
  } catch (err) {
    console.error('[aceIntents] POST /:intentId/complete:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to complete intent' }, 500);
  } finally {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// POST /:intentId/fail — Mark intent failed
// ---------------------------------------------------------------------------

router.post('/:intentId/fail', async (c) => {
  const intentId = c.req.param('intentId');

  let body: { reason?: unknown } = {};
  try { body = await c.req.json(); } catch {}

  const reason = typeof body.reason === 'string' ? body.reason.trim() : 'Unknown error';

  const sql = createDb(c.env);
  try {
    const rows = await sql<Array<{ id: string; status: string }>>`
      SELECT id, status FROM ace_intents WHERE id = ${intentId}
    `;

    if (!rows.length) return c.json({ error: 'Intent not found' }, 404);

    const terminal = ['completed', 'failed'];
    if (terminal.includes(rows[0].status)) {
      return c.json({ error: `Intent is already in terminal status '${rows[0].status}'.` }, 409);
    }

    await sql`
      UPDATE ace_intents
      SET
        status              = 'failed',
        recommendation_json = recommendation_json || ${JSON.stringify({ failureReason: reason, failedAt: new Date().toISOString() })}::jsonb,
        updated_at          = now()
      WHERE id = ${intentId}
    `;

    return c.json({ intentId, status: 'failed', reason });
  } catch (err) {
    console.error('[aceIntents] POST /:intentId/fail:', err instanceof Error ? err.message : err);
    return c.json({ error: 'Failed to mark intent as failed' }, 500);
  } finally {
    await sql.end();
  }
});

export { router as aceIntentsRouter };
