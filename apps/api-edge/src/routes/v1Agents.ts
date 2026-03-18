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
import { createFeeLedgerEntry, DEFAULT_FEE_BPS } from '../lib/feeLedger';

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
      INSERT INTO agent_identities
        (agent_id, owner_email, verified, kyc_status, created_at, updated_at)
      VALUES
        (${agentId}, ${systemEmail}, false, 'programmatic', NOW(), NOW())
    `;

    // Metadata stored via a second targeted update — avoids jsonb cast
    // complications in the initial INSERT on Hyperdrive connections.
    const metaStr = JSON.stringify({
      name: name ?? agentId,
      description,
      category,
      capabilities,
      agentKeyHash: keyHash,
      registeredAt: new Date().toISOString(),
      registrationMode: 'self_registered',
    });
    await sql`
      UPDATE agent_identities
      SET    metadata   = ${metaStr}::jsonb,
             updated_at = NOW()
      WHERE  agent_id   = ${agentId}
    `;

    // Seed starter AgentRank score so passport returns real data from day one.
    // Best-effort — never blocks registration if the table doesn't exist yet.
    await sql`
      INSERT INTO agentrank_scores
        (agent_id, score, grade, payment_reliability, service_delivery,
         transaction_volume, dispute_rate, unique_counterparties, stake_usdc,
         factors, history, created_at, updated_at)
      VALUES
        (${agentId}, 100, 'New', NULL, NULL,
         0, 0, 0, 0,
         ${JSON.stringify({ registration: 'self_registered', category })}::jsonb,
         ${JSON.stringify([])}::jsonb,
         NOW(), NOW())
      ON CONFLICT (agent_id) DO NOTHING
    `.catch(() => {});

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
          'Use PATCH /api/v1/agents/:agentId to update your profile and pricing.',
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
// PATCH /api/v1/agents/:agentId — update agent profile + marketplace metadata
//
// Auth: agentId + agentKey in request body (same as /pay).
// Updatable: name, description, category, capabilities, pricePerTaskUsd
// ---------------------------------------------------------------------------

router.patch('/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  if (!agentId || !/^[a-zA-Z0-9_-]{3,64}$/.test(agentId)) {
    return c.json({ error: 'INVALID_AGENT_ID' }, 400);
  }

  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { agentKey } = body as Record<string, string>;
  if (!agentKey || typeof agentKey !== 'string') {
    return c.json({ error: 'agentKey required for profile updates' }, 401);
  }

  const keyHash = await hashKey(agentKey);
  const sql = createDb(c.env);
  try {
    const rows = await sql<any[]>`
      SELECT agent_id, metadata FROM agent_identities WHERE agent_id = ${agentId} LIMIT 1
    `.catch(() => []);

    if (!rows.length) return c.json({ error: 'AGENT_NOT_FOUND' }, 404);
    if (rows[0].metadata?.agentKeyHash !== keyHash) {
      return c.json({ error: 'INVALID_AGENT_KEY' }, 401);
    }

    const existing = (rows[0].metadata ?? {}) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.slice(0, 80) : existing.name;
    const description = typeof body.description === 'string' ? body.description.slice(0, 500) : existing.description;
    const category = typeof body.category === 'string' ? body.category.slice(0, 50) : existing.category;
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities.slice(0, 20) : existing.capabilities;
    const pricePerTaskUsd = typeof body.pricePerTaskUsd === 'number' && body.pricePerTaskUsd >= 0
      ? body.pricePerTaskUsd
      : existing.pricePerTaskUsd ?? null;

    const updatedMeta = JSON.stringify({
      ...existing,
      name,
      description,
      category,
      capabilities,
      pricePerTaskUsd,
      updatedAt: new Date().toISOString(),
    });

    await sql`
      UPDATE agent_identities
      SET metadata = ${updatedMeta}::jsonb, updated_at = NOW()
      WHERE agent_id = ${agentId}
    `;

    // Also update agentrank_scores factors so marketplace discovery reflects new category/price
    await sql`
      UPDATE agentrank_scores
      SET factors = factors || ${JSON.stringify({ category, pricePerTaskUsd })}::jsonb,
          updated_at = NOW()
      WHERE agent_id = ${agentId}
    `.catch(() => {});

    return c.json({
      success: true,
      agentId,
      updated: { name, description, category, capabilities, pricePerTaskUsd },
      passportUrl: `https://app.agentpay.so/agent/${agentId}`,
      _schema: 'AgentProfileUpdate/1.0',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/agents/pay  — agent-native payment (no merchantId required)
//
// Agent authenticates with agentId + agentKey, specifies recipientAddress,
// amount, and purpose. Returns a Solana Pay URI + intentId.
// ---------------------------------------------------------------------------

router.post('/pay', async (c) => {
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { agentId, agentKey, recipientAddress, amount, purpose } = body as Record<string, string | number>;

  if (!agentId || typeof agentId !== 'string') return c.json({ error: 'agentId required' }, 400);
  if (!agentKey || typeof agentKey !== 'string') return c.json({ error: 'agentKey required' }, 400);
  if (!recipientAddress || typeof recipientAddress !== 'string' || recipientAddress.length < 32) {
    return c.json({ error: 'recipientAddress must be a valid Solana address' }, 400);
  }
  if (typeof amount !== 'number' || amount <= 0 || amount > 100000) {
    return c.json({ error: 'amount must be a positive number ≤ 100,000 USDC' }, 400);
  }

  // Verify agentKey against stored hash
  const keyHash = await hashKey(agentKey as string);
  const sql = createDb(c.env);
  try {
    const rows = await sql<any[]>`
      SELECT agent_id, metadata FROM agent_identities
      WHERE agent_id = ${agentId} LIMIT 1
    `.catch(() => []);

    if (!rows.length) return c.json({ error: 'AGENT_NOT_FOUND' }, 404);

    const storedHash = rows[0]?.metadata?.agentKeyHash;
    if (!storedHash || storedHash !== keyHash) {
      return c.json({ error: 'INVALID_AGENT_KEY', message: 'agentKey does not match.' }, 401);
    }

    // Create intent record (merchant_id = null for agent-native)
    const intentId = crypto.randomUUID();
    const verificationToken = `APV_${Date.now()}_${Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2,'0')).join('')}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await sql`
      INSERT INTO payment_intents
        (id, merchant_id, agent_id, amount, currency, status, verification_token, expires_at, metadata)
      VALUES
        (${intentId},
         NULL,
         ${agentId},
         ${amount as number},
         ${'USDC'},
         ${'pending'},
         ${verificationToken},
         ${expiresAt}::timestamptz,
         ${JSON.stringify({
           agentId,
           recipientAddress,
           purpose: purpose ?? null,
           protocol: 'agent_native',
         })}::jsonb)
    `.catch(() => {});

    const solanaPayUri = `solana:${recipientAddress}?amount=${amount}&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&memo=${encodeURIComponent(verificationToken)}`;

    // Fee ledger — record platform fee obligation (best-effort, never blocks payment)
    const treasuryWallet = c.env.PLATFORM_TREASURY_WALLET ?? '';
    if (treasuryWallet) {
      const feeBps = c.env.PLATFORM_FEE_BPS ? parseInt(c.env.PLATFORM_FEE_BPS, 10) : DEFAULT_FEE_BPS;
      await createFeeLedgerEntry(sql, {
        intentId,
        grossAmount: amount as number,
        feeBps: isNaN(feeBps) ? DEFAULT_FEE_BPS : feeBps,
        treasuryDestination: treasuryWallet,
        recipientDestination: recipientAddress as string,
        settlementReference: verificationToken,
      });
    }

    return c.json({
      success: true,
      intentId,
      verificationToken,
      expiresAt,
      instructions: {
        crypto: {
          network: 'solana',
          token: 'USDC',
          recipientAddress,
          amount,
          memo: verificationToken,
          solanaPayUri,
        },
      },
      verifyUrl: `https://api.agentpay.so/api/verify/${intentId}`,
      _schema: 'AgentNativePayment/1.0',
    }, 201);
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
