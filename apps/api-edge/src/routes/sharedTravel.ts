import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb, parseJsonb } from '../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

type SharedTravelUnitType = 'couple' | 'family' | 'household';
type SharedTravelMemberRole = 'partner' | 'adult' | 'child' | 'infant';

interface IdentityRow {
  metadata: unknown;
}

interface InviteRow {
  invite_id: string;
  unit_id: string;
  inviter_agent_id: string;
  invitee_contact: string;
  invitee_agent_id: string | null;
  status: string;
  role: string;
  unit_name: string;
  unit_type: string;
  notes: string | null;
  created_at: string;
  accepted_at: string | null;
  metadata: unknown;
}

interface AgentNameRow {
  metadata: unknown;
}

interface UnitRow {
  unit_id: string;
  owner_agent_id: string;
  unit_name: string;
  unit_type: string;
  primary_payer_agent_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyAgentKey(
  sql: ReturnType<typeof createDb>,
  agentId: string,
  agentKey: string,
): Promise<boolean> {
  const keyHash = await sha256(agentKey);
  const rows = await sql<IdentityRow[]>`
    SELECT metadata FROM agent_identities
    WHERE agent_id = ${agentId} LIMIT 1
  `.catch(() => [] as IdentityRow[]);
  const metadata = parseJsonb<{ agentKeyHash?: string }>(rows[0]?.metadata, {});
  return rows.length > 0 && metadata.agentKeyHash === keyHash;
}

async function ensureSchema(sql: ReturnType<typeof createDb>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS bro_shared_travel_units (
      unit_id UUID PRIMARY KEY,
      owner_agent_id TEXT NOT NULL,
      unit_name TEXT NOT NULL,
      unit_type TEXT NOT NULL,
      primary_payer_agent_id TEXT NULL,
      notes TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS bro_shared_travel_invites (
      invite_id UUID PRIMARY KEY,
      unit_id UUID NOT NULL REFERENCES bro_shared_travel_units(unit_id) ON DELETE CASCADE,
      inviter_agent_id TEXT NOT NULL,
      invitee_contact TEXT NOT NULL,
      invitee_agent_id TEXT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      invite_token TEXT NOT NULL UNIQUE,
      accepted_at TIMESTAMPTZ NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS bro_shared_travel_links (
      link_id UUID PRIMARY KEY,
      unit_id UUID NOT NULL REFERENCES bro_shared_travel_units(unit_id) ON DELETE CASCADE,
      owner_agent_id TEXT NOT NULL,
      linked_agent_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (unit_id, linked_agent_id)
    )
  `;
}

router.post('/invite', async (c) => {
  const body = await c.req.json<{
    agentId?: string;
    agentKey?: string;
    unitName?: string;
    unitType?: SharedTravelUnitType;
    inviteeContact?: string;
    inviteeName?: string;
    role?: SharedTravelMemberRole;
    notes?: string;
    primaryPayerAgentId?: string | null;
  }>().catch(() => null);

  if (!body?.agentId || !body.agentKey || !body.unitName || !body.unitType || !body.inviteeContact) {
    return c.json({ error: 'agentId, agentKey, unitName, unitType, and inviteeContact are required' }, 400);
  }

  const unitName = body.unitName.trim();
  const inviteeContact = body.inviteeContact.trim();

  const sql = createDb(c.env);
  try {
    await ensureSchema(sql);

    if (!(await verifyAgentKey(sql, body.agentId, body.agentKey))) {
      return c.json({ error: 'INVALID_AGENT_KEY' }, 401);
    }

    const unitId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();
    const inviteToken = crypto.randomUUID();

    await sql`
      INSERT INTO bro_shared_travel_units (
        unit_id,
        owner_agent_id,
        unit_name,
        unit_type,
        primary_payer_agent_id,
        notes
      ) VALUES (
        ${unitId},
        ${body.agentId},
        ${unitName},
        ${body.unitType},
        ${body.primaryPayerAgentId ?? body.agentId},
        ${body.notes?.trim() || null}
      )
    `;

    await sql`
      INSERT INTO bro_shared_travel_invites (
        invite_id,
        unit_id,
        inviter_agent_id,
        invitee_contact,
        role,
        invite_token,
        metadata
      ) VALUES (
        ${inviteId},
        ${unitId},
        ${body.agentId},
        ${inviteeContact},
        ${body.role ?? 'partner'},
        ${inviteToken},
        ${JSON.stringify({
          inviteeName: body.inviteeName?.trim() || null,
          notes: body.notes?.trim() || null,
        })}::jsonb
      )
    `;

    return c.json({
      ok: true,
      unitId,
      inviteId,
      inviteToken,
      status: 'pending',
      _note: 'Send inviteToken to the other Ace account to accept the shared travel link.',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

router.post('/accept/:token', async (c) => {
  const token = c.req.param('token');
  const body = await c.req.json<{
    agentId?: string;
    agentKey?: string;
    acceptedName?: string;
  }>().catch(() => null);

  if (!token || !body?.agentId || !body.agentKey) {
    return c.json({ error: 'token, agentId, and agentKey are required' }, 400);
  }

  const sql = createDb(c.env);
  try {
    await ensureSchema(sql);

    if (!(await verifyAgentKey(sql, body.agentId, body.agentKey))) {
      return c.json({ error: 'INVALID_AGENT_KEY' }, 401);
    }

    const invites = await sql<InviteRow[]>`
      SELECT
        i.invite_id,
        i.unit_id,
        i.inviter_agent_id,
        i.invitee_contact,
        i.invitee_agent_id,
        i.status,
        i.role,
        u.unit_name,
        u.unit_type,
        u.notes,
        i.created_at,
        i.accepted_at,
        i.metadata
      FROM bro_shared_travel_invites i
      JOIN bro_shared_travel_units u ON u.unit_id = i.unit_id
      WHERE i.invite_token = ${token}
      LIMIT 1
    `.catch(() => [] as InviteRow[]);

    const invite = invites[0];
    if (!invite) {
      return c.json({ error: 'INVITE_NOT_FOUND' }, 404);
    }
    if (invite.status === 'accepted') {
      return c.json({ error: 'INVITE_ALREADY_ACCEPTED' }, 409);
    }

    const acceptedName = body.acceptedName?.trim() || parseJsonb<{ inviteeName?: string | null }>(invite.metadata, {}).inviteeName || null;

    await sql`
      UPDATE bro_shared_travel_invites
      SET
        status = 'accepted',
        invitee_agent_id = ${body.agentId},
        accepted_at = NOW(),
        metadata = metadata || ${JSON.stringify({ acceptedName })}::jsonb
      WHERE invite_id = ${invite.invite_id}
    `;

    await sql`
      INSERT INTO bro_shared_travel_links (
        link_id,
        unit_id,
        owner_agent_id,
        linked_agent_id,
        role,
        metadata
      ) VALUES (
        ${crypto.randomUUID()},
        ${invite.unit_id},
        ${invite.inviter_agent_id},
        ${body.agentId},
        ${invite.role},
        ${JSON.stringify({
          inviteId: invite.invite_id,
          acceptedName,
          acceptedAt: new Date().toISOString(),
        })}::jsonb
      )
      ON CONFLICT (unit_id, linked_agent_id)
      DO UPDATE SET
        status = 'active',
        role = EXCLUDED.role,
        metadata = bro_shared_travel_links.metadata || EXCLUDED.metadata,
        updated_at = NOW()
    `;

    return c.json({
      ok: true,
      unitId: invite.unit_id,
      unitName: invite.unit_name,
      unitType: invite.unit_type,
      inviterAgentId: invite.inviter_agent_id,
      inviterName: await sql<AgentNameRow[]>`
        SELECT metadata FROM agent_identities
        WHERE agent_id = ${invite.inviter_agent_id}
        LIMIT 1
      `.then((rows) => parseJsonb<{ name?: string }>(rows[0]?.metadata, {}).name ?? null).catch(() => null),
      role: invite.role,
      linkedAgentId: body.agentId,
      status: 'accepted',
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

router.get('/units/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const agentKey = c.req.header('x-agent-key') ?? c.req.header('X-Agent-Key');

  if (!agentId || !agentKey) {
    return c.json({ error: 'agentId path param and x-agent-key header are required' }, 400);
  }

  const sql = createDb(c.env);
  try {
    await ensureSchema(sql);

    if (!(await verifyAgentKey(sql, agentId, agentKey))) {
      return c.json({ error: 'INVALID_AGENT_KEY' }, 401);
    }

    const units = await sql<UnitRow[]>`
      SELECT DISTINCT
        u.unit_id,
        u.owner_agent_id,
        u.unit_name,
        u.unit_type,
        u.primary_payer_agent_id,
        u.notes,
        u.created_at,
        u.updated_at
      FROM bro_shared_travel_units u
      LEFT JOIN bro_shared_travel_links l ON l.unit_id = u.unit_id AND l.status = 'active'
      WHERE u.owner_agent_id = ${agentId} OR l.linked_agent_id = ${agentId}
      ORDER BY u.updated_at DESC
    `.catch(() => [] as UnitRow[]);

    return c.json({
      units: units.map((unit) => ({
        unitId: unit.unit_id,
        ownerAgentId: unit.owner_agent_id,
        unitName: unit.unit_name,
        unitType: unit.unit_type,
        primaryPayerAgentId: unit.primary_payer_agent_id,
        notes: unit.notes,
        createdAt: unit.created_at,
        updatedAt: unit.updated_at,
      })),
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

export { router as sharedTravelRouter };
