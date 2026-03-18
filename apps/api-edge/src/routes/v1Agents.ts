/**
 * Agent self-registration — /api/v1/agents/*
 *
 * Allows AI agents to register themselves programmatically without a human
 * merchant account. Returns an agentId and agentKey that identify the agent
 * in the network.
 *
 * POST /api/v1/agents/register
 *   Body: { name?, description?, category?, capabilities? }
 *   Returns: { agentId, agentKey, passportUrl, _note }
 *
 * GET /api/v1/agents/:agentId
 *   Returns the agent's public identity record.
 *
 * Note: agentKey is shown once at registration. Store it securely.
 * To create payment intents as this agent, provide merchantId from a
 * registered merchant account. Agent-native payment initiation (no merchantId)
 * is coming in Phase 2.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateAgentId(): string {
  return `agt_${randomHex(8)}`;
}

function generateAgentKey(): string {
  return `agk_${randomHex(24)}`;
}

// ---------------------------------------------------------------------------
// POST /api/v1/agents/register
// ---------------------------------------------------------------------------

router.post('/register', async (c) => {
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    // empty body is fine — all fields optional
  }

  const name = typeof body.name === 'string' ? body.name.slice(0, 80) : null;
  const description = typeof body.description === 'string' ? body.description.slice(0, 500) : null;
  const category = typeof body.category === 'string' ? body.category.slice(0, 50) : 'general';
  const capabilities = Array.isArray(body.capabilities) ? body.capabilities.slice(0, 20) : [];

  const agentId = generateAgentId();
  const agentKey = generateAgentKey();

  // Hash the agentKey before storing — we only return it plaintext once.
  const keyHash = await hashKey(agentKey);

  // System email placeholder — makes the DB constraint happy without human input.
  const systemEmail = `agent.${agentId}@agents.agentpay.so`;

  const sql = createDb(c.env);
  try {
    await sql`
      INSERT INTO agent_identities (
        agent_id,
        owner_email,
        verified,
        kyc_status,
        metadata,
        created_at,
        updated_at
      ) VALUES (
        ${agentId},
        ${systemEmail},
        false,
        'programmatic',
        ${JSON.stringify({
          name: name ?? agentId,
          description,
          category,
          capabilities,
          agentKeyHash: keyHash,
          registeredAt: new Date().toISOString(),
          registrationMode: 'self_registered',
        })}::jsonb,
        NOW(),
        NOW()
      )
    `;

    return c.json(
      {
        success: true,
        agentId,
        agentKey,
        passportUrl: `https://app.agentpay.so/agent/${agentId}`,
        _note: [
          'agentKey is shown once — store it securely.',
          'Use agentId when creating payment intents (agentId field).',
          'Trust score builds automatically after confirmed transactions.',
          'Agent-native payment initiation without merchantId is coming in Phase 2.',
        ],
        _schema: 'AgentRegistration/1.0',
      },
      201,
    );
  } catch (err: any) {
    console.error('[v1/agents/register] error:', err?.message);
    if (err?.message?.includes('unique') || err?.code === '23505') {
      return c.json({ error: 'AGENT_EXISTS', message: 'An agent with this ID already exists.' }, 409);
    }
    return c.json({ error: 'REGISTRATION_FAILED', message: 'Could not register agent.' }, 500);
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/agents/:agentId — public agent identity lookup
// ---------------------------------------------------------------------------

router.get('/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  if (!agentId || !/^[a-zA-Z0-9_-]{3,64}$/.test(agentId)) {
    return c.json({ error: 'INVALID_AGENT_ID' }, 400);
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql`
      SELECT
        agent_id    AS "agentId",
        verified,
        kyc_status  AS "kycStatus",
        metadata,
        created_at  AS "registeredAt"
      FROM agent_identities
      WHERE agent_id = ${agentId}
      LIMIT 1
    `.catch(() => []);

    if (!rows[0]) {
      return c.json(
        {
          error: 'AGENT_NOT_FOUND',
          message: `Agent ${agentId} not found. Agents appear after self-registration or first confirmed transaction.`,
          agentId,
        },
        404,
      );
    }

    const r = rows[0];
    const meta = (r.metadata ?? {}) as Record<string, unknown>;

    return c.json({
      agentId: r.agentId,
      name: (meta.name as string) ?? r.agentId,
      description: (meta.description as string) ?? null,
      category: (meta.category as string) ?? 'general',
      capabilities: (meta.capabilities as string[]) ?? [],
      verified: r.verified,
      kycStatus: r.kycStatus,
      registeredAt: r.registeredAt,
      registrationMode: (meta.registrationMode as string) ?? 'unknown',
      passportUrl: `https://app.agentpay.so/agent/${r.agentId}`,
      _schema: 'AgentIdentity/1.0',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Crypto helper — SHA-256 hash of agentKey for storage
// ---------------------------------------------------------------------------

async function hashKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export { router as v1AgentsRouter };
