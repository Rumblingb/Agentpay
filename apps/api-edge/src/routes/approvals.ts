/**
 * Approval Session API — /api/approvals/*
 *
 * Universal approval entry point for any AgentPay surface (Ace mobile,
 * agent delegation, CRM recurring).  Records who approved, how, on which
 * device (one-way hash), and what policy was applied.
 *
 * Endpoints:
 *   POST /api/approvals/session         — create a pending approval session
 *   POST /api/approvals/:sessionId/confirm — mark approved (device sends token)
 *   GET  /api/approvals/:sessionId      — poll status
 *
 * Auth: all routes require a valid merchant API key (authenticateApiKey).
 *
 * GDPR compliance:
 *   - Biometric templates are NEVER sent to the server. expo-local-authentication
 *     returns a boolean; the device sends only an ephemeral approvalToken (UUID).
 *   - device_hash is SHA-256(rawDeviceId + APPROVAL_SALT). The raw device ID
 *     is never stored. APPROVAL_SALT is a Workers secret. This satisfies
 *     GDPR Article 9 (special category data) and CCPA obligations.
 *
 * ─── DB migration required ──────────────────────────────────────────────────
 *
 * Run once against your Supabase Direct connection (port 5432):
 *
 * CREATE TABLE IF NOT EXISTS approval_events (
 *   id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
 *   intent_id      uuid        REFERENCES ace_intents(id) ON DELETE SET NULL,
 *   principal_id   text        NOT NULL,
 *   method         text        NOT NULL,
 *   device_hash    text,
 *   amount_pence   integer     NOT NULL,
 *   currency       text        NOT NULL DEFAULT 'GBP',
 *   policy_version text,
 *   approved_at    timestamptz,
 *   expires_at     timestamptz NOT NULL,
 *   created_at     timestamptz NOT NULL DEFAULT now()
 * );
 *
 * CREATE INDEX IF NOT EXISTS approval_events_principal_idx ON approval_events (principal_id);
 * CREATE INDEX IF NOT EXISTS approval_events_intent_idx    ON approval_events (intent_id);
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { createDb } from '../lib/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalMethod =
  | 'biometric_ios'
  | 'biometric_android'
  | 'apple_pay'
  | 'google_pay'
  | 'agent_policy'
  | 'auto_threshold'
  | 'mandate_recurring';

interface ApprovalEventRow {
  id: string;
  intent_id: string | null;
  principal_id: string;
  method: string;
  device_hash: string | null;
  amount_pence: number;
  currency: string;
  policy_version: string | null;
  approved_at: Date | null;
  expires_at: Date;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex digest using the Workers SubtleCrypto API. */
async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const VALID_METHODS: ApprovalMethod[] = [
  'biometric_ios',
  'biometric_android',
  'apple_pay',
  'google_pay',
  'agent_policy',
  'auto_threshold',
  'mandate_recurring',
];

function isValidMethod(value: unknown): value is ApprovalMethod {
  return typeof value === 'string' && (VALID_METHODS as string[]).includes(value);
}

/** Session expires in 5 minutes by default. */
const SESSION_TTL_MS = 5 * 60 * 1_000;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

router.use('*', authenticateApiKey);

// ---------------------------------------------------------------------------
// POST / — Create a pending approval session
// ---------------------------------------------------------------------------

router.post('/', async (c) => {
  let body: {
    principalId?: unknown;
    intentId?: unknown;
    amount?: unknown;
    currency?: unknown;
    method?: unknown;
    policyVersion?: unknown;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { principalId, intentId, amount, currency, method, policyVersion } = body;

  if (typeof principalId !== 'string' || !principalId.trim()) {
    return c.json({ error: 'principalId is required' }, 400);
  }
  if (!Number.isInteger(amount) || (amount as number) < 0) {
    return c.json({ error: 'amount must be a non-negative integer (pence/cents)' }, 400);
  }
  if (typeof currency !== 'string' || currency.trim().length !== 3) {
    return c.json({ error: 'currency must be a 3-letter ISO 4217 code' }, 400);
  }

  const resolvedMethod: ApprovalMethod = isValidMethod(method) ? method : 'biometric_ios';
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const sql = createDb(c.env);
  try {
    const rows = await sql<Array<{ id: string; expires_at: Date }>>`
      INSERT INTO approval_events (
        principal_id,
        intent_id,
        method,
        amount_pence,
        currency,
        policy_version,
        expires_at
      ) VALUES (
        ${principalId.trim()},
        ${typeof intentId === 'string' && intentId.trim() ? intentId.trim() : null},
        ${resolvedMethod},
        ${amount as number},
        ${(currency as string).trim().toUpperCase()},
        ${typeof policyVersion === 'string' && policyVersion.trim() ? policyVersion.trim() : null},
        ${expiresAt.toISOString()}
      )
      RETURNING id, expires_at
    `;

    const row = rows[0];
    return c.json({
      sessionId: row.id,
      method: resolvedMethod,
      expiresAt: row.expires_at,
    }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[approvals] POST /: DB error:', msg);
    return c.json({ error: 'Failed to create approval session' }, 500);
  } finally {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// POST /:sessionId/confirm — Confirm approval (device sends token + optional deviceId)
// ---------------------------------------------------------------------------

router.post('/:sessionId/confirm', async (c) => {
  const sessionId = c.req.param('sessionId');

  let body: { approvalToken?: unknown; deviceId?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { approvalToken, deviceId } = body;
  if (typeof approvalToken !== 'string' || !approvalToken.trim()) {
    return c.json({ error: 'approvalToken is required' }, 400);
  }

  // Compute device hash if deviceId provided — never store the raw deviceId.
  let deviceHash: string | null = null;
  if (typeof deviceId === 'string' && deviceId.trim()) {
    const salt = c.env.APPROVAL_SALT ?? 'agentpay-approval-salt';
    deviceHash = await sha256Hex(deviceId.trim() + salt);
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql<ApprovalEventRow[]>`
      SELECT *
      FROM approval_events
      WHERE id = ${sessionId}
    `;

    if (!rows.length) {
      return c.json({ error: 'Approval session not found' }, 404);
    }

    const session = rows[0];

    if (session.approved_at) {
      return c.json({ error: 'Approval session already confirmed' }, 409);
    }
    if (new Date(session.expires_at) < new Date()) {
      return c.json({ error: 'Approval session has expired' }, 410);
    }

    const updated = await sql<Array<{ id: string; approved_at: Date }>>`
      UPDATE approval_events
      SET
        approved_at = now(),
        device_hash = ${deviceHash}
      WHERE id = ${sessionId}
      RETURNING id, approved_at
    `;

    const row = updated[0];
    return c.json({
      sessionId: row.id,
      approved: true,
      approvedAt: row.approved_at,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[approvals] POST /:sessionId/confirm: DB error:', msg);
    return c.json({ error: 'Failed to confirm approval' }, 500);
  } finally {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// GET /:sessionId — Poll approval session status
// ---------------------------------------------------------------------------

router.get('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');

  const sql = createDb(c.env);
  try {
    const rows = await sql<ApprovalEventRow[]>`
      SELECT *
      FROM approval_events
      WHERE id = ${sessionId}
    `;

    if (!rows.length) {
      return c.json({ error: 'Approval session not found' }, 404);
    }

    const session = rows[0];
    const now = new Date();
    const expired = !session.approved_at && new Date(session.expires_at) < now;

    return c.json({
      sessionId: session.id,
      principalId: session.principal_id,
      intentId: session.intent_id,
      method: session.method,
      amountPence: session.amount_pence,
      currency: session.currency,
      status: session.approved_at ? 'approved' : expired ? 'expired' : 'pending',
      approvedAt: session.approved_at,
      expiresAt: session.expires_at,
      createdAt: session.created_at,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[approvals] GET /:sessionId: DB error:', msg);
    return c.json({ error: 'Failed to fetch approval session' }, 500);
  } finally {
    await sql.end();
  }
});

export { router as approvalsRouter };
