/**
 * Trip Rooms — shared live journey for family/group travel
 *
 * A trip room is created when a job is confirmed. It has a short share token
 * that anyone can join with one tap — no account needed.
 *
 * Routes:
 *   POST /api/trip-rooms               — create a room for a job (called after Phase 2 confirm)
 *   POST /api/trip-rooms/:token/join   — add a member (push token) to a room
 *   GET  /api/trip-rooms/:token        — get room status (used by joinable web view + Meridian)
 *   GET  /trip/:token                  — lightweight HTML page for non-app users (no auth)
 *
 * Fan-out: when Darwin pushes a platform change / delay / cancel, stripeWebhooks.ts
 * also queries trip_rooms WHERE job_id = ? and fans out to all member push tokens.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';

export const tripRoomsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

function broLog(event: string, data: Record<string, unknown>) {
  console.info(JSON.stringify({ bro: true, event, ...data }));
}

function authCheck(c: { req: { header: (k: string) => string | undefined }; env: Env; json: (d: unknown, s?: number) => Response }): boolean {
  if (!c.env.BRO_CLIENT_KEY) return true;
  const key = c.req.header('x-bro-key') ?? '';
  return key === c.env.BRO_CLIENT_KEY;
}

/** Generate a short URL-safe share token: 8 base-36 chars */
function makeShareToken(): string {
  const ts   = Date.now().toString(36).slice(-4);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}${rand}`;
}

type TripRoomRow = {
  id: string;
  job_id: string;
  members: any[];
  expires_at: string;
  share_token: string;
};

function normalizeMembers(members: unknown): any[] {
  return Array.isArray(members) ? members : [];
}

function appendMemberIfNeeded(members: any[], pushToken?: string, name?: string, role?: string): { members: any[]; added: boolean } {
  if (!pushToken) return { members, added: false };
  if (members.some((member: any) => member?.pushToken === pushToken)) {
    return { members, added: false };
  }
  return {
    members: [
      ...members,
      {
        name: name ?? 'Guest',
        pushToken,
        role: role ?? 'guest',
        joinedAt: new Date().toISOString(),
      },
    ],
    added: true,
  };
}

async function loadRoom(sql: ReturnType<typeof createDb>, token: string): Promise<TripRoomRow | null> {
  const rows = await sql<TripRoomRow[]>`
    SELECT id, job_id, members, expires_at, share_token
    FROM trip_rooms
    WHERE share_token = ${token}
    LIMIT 1
  `.catch(() => []);
  return rows[0] ?? null;
}

async function loadRoomForJob(sql: ReturnType<typeof createDb>, jobId: string): Promise<TripRoomRow | null> {
  const directRows = await sql<TripRoomRow[]>`
    SELECT id, job_id, members, expires_at, share_token
    FROM trip_rooms
    WHERE job_id = ${jobId}
    LIMIT 1
  `.catch(() => []);
  if (directRows[0]) return directRows[0];

  const journeyRows = await sql<TripRoomRow[]>`
    SELECT tr.id, tr.job_id, tr.members, tr.expires_at, tr.share_token
    FROM payment_intents pi
    JOIN payment_intents anchor_pi
      ON anchor_pi.metadata->>'journeyId' = pi.metadata->>'journeyId'
    JOIN trip_rooms tr
      ON tr.job_id = anchor_pi.id
    WHERE pi.id = ${jobId}
      AND pi.metadata->>'journeyId' IS NOT NULL
    LIMIT 1
  `.catch(() => []);
  return journeyRows[0] ?? null;
}

// ── POST /api/trip-rooms ──────────────────────────────────────────────────────
// Create a trip room for a confirmed job. Idempotent — returns existing if already created.

tripRoomsRouter.post('/', async (c) => {
  if (!authCheck(c)) return c.json({ error: 'Unauthorized' }, 401);

  const { jobId, ownerPushToken } = await c.req.json<{ jobId: string; ownerPushToken?: string }>();
  if (!jobId) return c.json({ error: 'jobId required' }, 400);

  const sql = createDb(c.env);
  try {
    // Check if room already exists for this job
    const existing = await sql<TripRoomRow[]>`
      SELECT id, job_id, members, expires_at, share_token
      FROM trip_rooms
      WHERE job_id = ${jobId}
      LIMIT 1
    `.catch(() => []);

    if (existing.length > 0) {
      const room = existing[0]!;
      const currentMembers = normalizeMembers(room.members);
      const ownerUpdate = appendMemberIfNeeded(currentMembers, ownerPushToken, 'Owner', 'owner');
      if (ownerUpdate.added) {
        await sql`
          UPDATE trip_rooms SET members = ${JSON.stringify(ownerUpdate.members)}::jsonb WHERE id = ${room.id}
        `;
      }
      return c.json({
        shareToken: room.share_token,
        roomId: room.id,
        created: false,
        memberCount: ownerUpdate.added ? ownerUpdate.members.length : currentMembers.length,
      });
    }

    const shareToken = makeShareToken();
    const expiresAt  = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48h
    const members    = ownerPushToken
      ? JSON.stringify([{ pushToken: ownerPushToken, role: 'owner', joinedAt: new Date().toISOString() }])
      : JSON.stringify([]);

    const rows = await sql<{ id: string }[]>`
      INSERT INTO trip_rooms (job_id, share_token, members, expires_at, created_at)
      VALUES (${jobId}, ${shareToken}, ${members}::jsonb, ${expiresAt}, NOW())
      RETURNING id
    `;

    broLog('trip_room_created', { jobId, shareToken });
    return c.json({ shareToken, roomId: rows[0]?.id ?? null, created: true });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ── POST /api/trip-rooms/:token/join ─────────────────────────────────────────
// Add a member to a room. Called when someone taps the shared link.

tripRoomsRouter.post('/:token/join', async (c) => {
  const token     = c.req.param('token');
  const body = await c.req.json<{ name?: string; pushToken?: string }>().catch(() => ({ name: undefined, pushToken: undefined }));
  const name      = body.name;
  const pushToken = body.pushToken;

  const sql = createDb(c.env);
  try {
    const room = await loadRoom(sql, token);
    if (!room) return c.json({ error: 'Trip room not found or expired' }, 404);

    if (new Date(room.expires_at) < new Date()) {
      return c.json({ error: 'This trip has ended' }, 410);
    }

    const members = normalizeMembers(room.members);
    const joinUpdate = appendMemberIfNeeded(members, pushToken, name, 'guest');
    const nextMembers = joinUpdate.added
      ? joinUpdate.members
      : pushToken
      ? members
      : [...members, { name: name ?? 'Guest', pushToken: null, joinedAt: new Date().toISOString() }];
    if (joinUpdate.added || !pushToken) {
      await sql`
        UPDATE trip_rooms SET members = ${JSON.stringify(nextMembers)}::jsonb WHERE id = ${room.id}
      `;
    }

    broLog('trip_room_joined', { token, jobId: room.job_id, member: name ?? 'Guest' });

    // Return the job status so they can render the live view
    const job = await sql<{ status: string; metadata: any }[]>`
      SELECT status, metadata FROM payment_intents WHERE id = ${room.job_id} LIMIT 1
    `.catch(() => []);

    return c.json({
      ok: true,
      jobId: room.job_id,
      memberCount: nextMembers.length,
      jobStatus: job[0]?.status ?? null,
      trainDetails: job[0]?.metadata?.trainDetails ?? null,
      flightDetails: job[0]?.metadata?.flightDetails ?? null,
      bookingRef: job[0]?.metadata?.broRef ?? job[0]?.metadata?.bookingReference ?? null,
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ── GET /api/trip-rooms/:token ────────────────────────────────────────────────
// Fetch live trip room status. Used by the Meridian app + the joinable web view.

tripRoomsRouter.get('/:token', async (c) => {
  const token = c.req.param('token');

  const sql = createDb(c.env);
  try {
    const room = await loadRoom(sql, token);
    if (!room) return c.json({ error: 'Not found' }, 404);
    if (new Date(room.expires_at) < new Date()) {
      return c.json({ error: 'This trip has ended' }, 410);
    }

    const job = await sql<{ status: string; metadata: any }[]>`
      SELECT status, metadata FROM payment_intents WHERE id = ${room.job_id} LIMIT 1
    `.catch(() => []);

    const meta      = job[0]?.metadata ?? {};
    const train     = meta.trainDetails ?? null;
    const flight    = meta.flightDetails ?? null;
    const members   = normalizeMembers(room.members);

    return c.json({
      shareToken:   token,
      jobId:        room.job_id,
      status:       job[0]?.status ?? 'unknown',
      memberCount:  members.length,
      members:      members.map((m: any) => ({ name: m.name ?? 'Guest', joinedAt: m.joinedAt })),
      expiresAt:    room.expires_at,
      trainDetails: train ? {
        from:          train.origin,
        to:            train.destination,
        departureTime: train.departureTime,
        arrivalTime:   train.arrivalTime,
        platform:      train.platform,
        operator:      train.operator,
        bookingRef:    meta.broRef ?? null,
        dataSource:    train.dataSource,
      } : null,
      flightDetails: flight ? {
        carrier:     flight.carrier,
        flightNumber: flight.flightNumber,
        from:        flight.origin,
        to:          flight.destination,
        departureAt: flight.departureAt,
        arrivalAt:   flight.arrivalAt,
        pnr:         flight.pnr ?? null,
      } : null,
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ── GET /trip/:token — joinable HTML web view ─────────────────────────────────
// Rendered without auth — for people who don't have the Bro app.
// Returns a simple HTML page that auto-refreshes every 30s.

tripRoomsRouter.get('/view/:token', async (c) => {
  const token = c.req.param('token');

  const sql = createDb(c.env);
  try {
    const room = await loadRoom(sql, token);
    if (!room) {
      return new Response(notFoundHtml(), { headers: { 'Content-Type': 'text/html' } });
    }
    if (new Date(room.expires_at) < new Date()) {
      return new Response(notFoundHtml('This trip has ended.'), { headers: { 'Content-Type': 'text/html' }, status: 410 });
    }
    const job  = await sql<{ status: string; metadata: any }[]>`
      SELECT status, metadata FROM payment_intents WHERE id = ${room.job_id} LIMIT 1
    `.catch(() => []);

    const meta   = job[0]?.metadata ?? {};
    const train  = meta.trainDetails ?? null;
    const flight = meta.flightDetails ?? null;
    const status = job[0]?.status ?? 'unknown';
    const ref    = meta.broRef ?? meta.bookingReference ?? null;

    const html = tripRoomHtml({ token, train, flight, status, ref, memberCount: normalizeMembers(room.members).length });
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ── Internal: fan-out push to all room members ────────────────────────────────
// Called by stripeWebhooks.ts (Darwin disruption polling) to notify all room members.

export async function fanOutToTripRoom(
  jobId: string,
  message: string,
  db: ReturnType<typeof createDb>,
): Promise<void> {
  try {
    const room = await loadRoomForJob(db, jobId);
    if (!room) return;

    const members: any[] = Array.isArray(room.members) ? room.members : [];
    const pushTokens = members.map((m: any) => m.pushToken).filter(Boolean) as string[];

    if (pushTokens.length === 0) return;

    // Send Expo push notification to each member
    await fetch('https://exp.host/--/api/v2/push/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(pushTokens.map(token => ({
        to:    token,
        title: 'Trip update',
        body:  message,
        data:  { jobId },
      }))),
    }).catch(() => {});

    console.info(JSON.stringify({ bro: true, event: 'trip_room_fanout', jobId, roomJobId: room.job_id, memberCount: pushTokens.length }));
  } catch {
    // Fire-and-forget — never block the main flow
  }
}

// ── HTML templates ────────────────────────────────────────────────────────────

function notFoundHtml(message = 'This trip may have ended or the link is invalid.'): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trip not found</title>
<style>body{background:#080808;color:#f8fafc;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#111;border:1px solid #1e293b;border-radius:12px;padding:32px;max-width:340px;text-align:center}
h1{color:#4ade80;font-size:18px;margin:0 0 8px}p{color:#94a3b8;font-size:14px;margin:0}</style>
</head><body><div class="card"><h1>Trip not found</h1><p>${message}</p></div></body></html>`;
}

interface TripHtmlParams {
  token: string;
  train: any;
  flight: any;
  status: string;
  ref: string | null;
  memberCount: number;
}

function tripRoomHtml({ token, train, flight, status, ref, memberCount }: TripHtmlParams): string {
  const statusLabel = status === 'completed' ? 'Ticketed' : status === 'failed' ? 'Failed' : 'Securing';
  const statusColor = status === 'completed' ? '#4ade80' : status === 'failed' ? '#f87171' : '#facc15';

  let journeyHtml = '';

  if (train) {
    const dep = train.departureTime ?? '';
    const arr = train.arrivalTime   ?? '';
    journeyHtml = `
      <div class="row"><span class="label">Route</span><span class="val">${train.origin ?? ''} → ${train.destination ?? ''}</span></div>
      ${dep ? `<div class="row"><span class="label">Departs</span><span class="val">${dep}</span></div>` : ''}
      ${arr ? `<div class="row"><span class="label">Arrives</span><span class="val">${arr}</span></div>` : ''}
      ${train.platform ? `<div class="row"><span class="label">Platform</span><span class="val">${train.platform}</span></div>` : ''}
      ${train.operator ? `<div class="row"><span class="label">Operator</span><span class="val">${train.operator}</span></div>` : ''}
    `;
  } else if (flight) {
    journeyHtml = `
      <div class="row"><span class="label">Route</span><span class="val">${flight.origin ?? ''} → ${flight.destination ?? ''}</span></div>
      <div class="row"><span class="label">Flight</span><span class="val">${flight.carrier ?? ''} ${flight.flightNumber ?? ''}</span></div>
      ${flight.departureAt ? `<div class="row"><span class="label">Departs</span><span class="val">${new Date(flight.departureAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span></div>` : ''}
      ${flight.pnr ? `<div class="row"><span class="label">PNR</span><span class="val" style="color:#4ade80;font-weight:700;letter-spacing:2px">${flight.pnr}</span></div>` : ''}
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>Live trip · Bro</title>
  <style>
    *{box-sizing:border-box}
    body{background:#080808;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px;margin:0;max-width:420px;margin:0 auto}
    .header{display:flex;align-items:center;gap:8px;margin-bottom:24px}
    .dot{width:8px;height:8px;background:#4ade80;border-radius:50%}
    .brand{font-size:20px;font-weight:700;letter-spacing:-0.5px}
    .card{background:#111827;border:1px solid #1e293b;border-radius:12px;padding:20px;margin-bottom:16px}
    .status-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
    .status-badge{font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px;background:#0f172a;color:${statusColor};border:1px solid ${statusColor}30}
    .members{font-size:12px;color:#94a3b8}
    .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1e293b20}
    .row:last-child{border-bottom:none}
    .label{font-size:13px;color:#94a3b8}
    .val{font-size:13px;color:#f8fafc;font-weight:500;text-align:right;max-width:60%}
    ${ref ? `.ref{background:#052e16;border:1px solid #166534;border-radius:8px;padding:12px 16px;text-align:center;margin-bottom:16px}
    .ref-label{font-size:11px;color:#4ade80;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px}
    .ref-val{font-size:22px;font-weight:700;letter-spacing:4px;color:#f8fafc}` : ''}
    .footer{text-align:center;font-size:12px;color:#475569;margin-top:24px}
    .footer a{color:#4ade80;text-decoration:none}
    .refresh{font-size:11px;color:#475569;text-align:center;margin-top:8px}
  </style>
</head>
<body>
  <div class="header"><div class="dot"></div><div class="brand">bro</div></div>

  ${ref ? `<div class="ref"><div class="ref-label">Booking ref</div><div class="ref-val">${ref}</div></div>` : ''}

  <div class="card">
    <div class="status-row">
      <span class="status-badge">${statusLabel}</span>
      <span class="members">${memberCount} traveller${memberCount !== 1 ? 's' : ''}</span>
    </div>
    ${journeyHtml || '<div style="color:#94a3b8;font-size:14px">Journey details loading…</div>'}
  </div>

  <div class="footer">
    Managed by <a href="https://bro.app">Bro</a> · Live trip view
  </div>
  <div class="refresh">Refreshes automatically every 30 seconds</div>
</body>
</html>`;
}
