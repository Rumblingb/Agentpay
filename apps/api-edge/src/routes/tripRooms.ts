/**
 * Trip Rooms â€” shared live journey for family/group travel
 *
 * A trip room is created when a job is confirmed. It has a short share token
 * that anyone can join with one tap â€” no account needed.
 *
 * Routes:
 *   POST /api/trip-rooms               â€” create a room for a job (called after Phase 2 confirm)
 *   POST /api/trip-rooms/:token/join   â€” add a member (push token) to a room
 *   GET  /api/trip-rooms/:token        â€” get room status (used by joinable web view + Meridian)
 *   GET  /trip/:token                  â€” lightweight HTML page for non-app users (no auth)
 *
 * Fan-out: when Darwin pushes a platform change / delay / cancel, stripeWebhooks.ts
 * also queries trip_rooms WHERE job_id = ? and fans out to all member push tokens.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';
import { toJourneyLegStatus } from '../lib/bookingState';
import { buildJourneyGraph } from '../lib/journeyGraph';
import type { JourneyGraph } from '../../../../packages/bro-trip/index';

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

type JourneyLegView = {
  jobId: string;
  status: string;
  mode: 'rail' | 'bus' | 'flight' | 'hotel' | 'other';
  label: string;
  from?: string | null;
  to?: string | null;
  departureTime?: string | null;
  arrivalTime?: string | null;
  operator?: string | null;
  bookingRef?: string | null;
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

function buildJourneyLeg(job: { id: string; status: string; metadata: any }): JourneyLegView {
  const meta = job.metadata ?? {};
  const legStatus = toJourneyLegStatus(job.status, meta);
  const train = meta.trainDetails ?? null;
  const flight = meta.flightDetails ?? null;
  const hotel = meta.hotelDetails ?? null;
  const trip = meta.tripContext ?? null;

  if (flight) {
    return {
      jobId: job.id,
      status: legStatus,
      mode: 'flight',
      label: `${flight.carrier ?? 'Flight'} ${flight.flightNumber ?? ''}`.trim(),
      from: flight.origin ?? null,
      to: flight.destination ?? null,
      departureTime: flight.departureAt ?? null,
      arrivalTime: flight.arrivalAt ?? null,
      operator: flight.carrier ?? null,
      bookingRef: flight.pnr ?? meta.broRef ?? meta.bookingReference ?? null,
    };
  }

  if (hotel) {
    return {
      jobId: job.id,
      status: legStatus,
      mode: 'hotel',
      label: hotel.bestOption?.name ?? trip?.title ?? 'Hotel',
      from: hotel.city ?? null,
      to: hotel.city ?? null,
      departureTime: hotel.checkIn ?? null,
      arrivalTime: hotel.checkOut ?? null,
      operator: hotel.bestOption?.name ?? null,
      bookingRef: meta.broRef ?? meta.bookingReference ?? null,
    };
  }

  if (train) {
    const mode = train.transportMode === 'bus' ? 'bus' : 'rail';
    return {
      jobId: job.id,
      status: legStatus,
      mode,
      label: train.operator ?? (mode === 'bus' ? 'Coach' : 'Rail'),
      from: train.origin ?? null,
      to: train.destination ?? null,
      departureTime: train.departureDatetime ?? train.departureTime ?? null,
      arrivalTime: train.arrivalTime ?? null,
      operator: train.operator ?? null,
      bookingRef: meta.broRef ?? meta.bookingReference ?? null,
    };
  }

  return {
    jobId: job.id,
    status: legStatus,
    mode: 'other',
    label: trip?.title ?? 'Journey leg',
    from: trip?.origin ?? null,
    to: trip?.destination ?? null,
    departureTime: trip?.departureTime ?? null,
    arrivalTime: trip?.arrivalTime ?? null,
    operator: trip?.operator ?? null,
    bookingRef: trip?.bookingRef ?? meta.broRef ?? meta.bookingReference ?? null,
  };
}

function deriveRoomExpiry(legs: JourneyLegView[], now = Date.now()): string {
  const minExpiry = now + 48 * 60 * 60 * 1000;
  const latestTravelInstant = legs.reduce<number | null>((latest, leg) => {
    const candidates = [leg.departureTime, leg.arrivalTime]
      .map((value) => (value ? Date.parse(value) : Number.NaN))
      .filter((value) => Number.isFinite(value));
    const legLatest = candidates.length ? Math.max(...candidates) : null;
    if (legLatest == null) return latest;
    return latest == null ? legLatest : Math.max(latest, legLatest);
  }, null);
  const tripAwareExpiry = latestTravelInstant != null
    ? latestTravelInstant + 18 * 60 * 60 * 1000
    : minExpiry;
  return new Date(Math.max(minExpiry, tripAwareExpiry)).toISOString();
}

function deriveJourneyStatus(legs: JourneyLegView[], fallback: string): string {
  if (legs.length === 0) return fallback;
  if (legs.some(l => ['failed', 'expired', 'rejected'].includes(l.status))) return 'failed';
  if (legs.every(l => ['completed', 'confirmed', 'verified'].includes(l.status))) return 'completed';
  return fallback;
}

async function loadJourneyLegs(
  sql: ReturnType<typeof createDb>,
  jobId: string,
): Promise<{ journeyId: string | null; legs: JourneyLegView[]; anchorMetadata: any; anchorStatus: string; journeyStatus: string }> {
  const anchorRows = await sql<{ id: string; status: string; metadata: any }[]>`
    SELECT id, status, metadata
    FROM payment_intents
    WHERE id = ${jobId}
    LIMIT 1
  `.catch(() => []);

  const anchor = anchorRows[0];
  if (!anchor) {
    return { journeyId: null, legs: [], anchorMetadata: {}, anchorStatus: 'unknown', journeyStatus: 'unknown' };
  }

  const journeyId = (anchor.metadata?.journeyId as string | undefined) ?? null;
  if (!journeyId) {
    const legs = [buildJourneyLeg(anchor)];
    return {
      journeyId: null,
      legs,
      anchorMetadata: anchor.metadata ?? {},
      anchorStatus: anchor.status,
      journeyStatus: deriveJourneyStatus(legs, anchor.status),
    };
  }

  const journeyRows = await sql<{ id: string; status: string; metadata: any; created_at: string }[]>`
    SELECT id, status, metadata, created_at
    FROM payment_intents
    WHERE id = ${jobId} OR metadata->>'journeyId' = ${journeyId}
    ORDER BY
      COALESCE(NULLIF(metadata->>'legIndex', '')::int, 999),
      created_at ASC
  `.catch(() => anchorRows as any);

  const legs = journeyRows.map((row: { id: string; status: string; metadata: any }) => buildJourneyLeg(row));
  return {
    journeyId,
    legs,
    anchorMetadata: anchor.metadata ?? {},
    anchorStatus: anchor.status,
    journeyStatus: deriveJourneyStatus(legs, anchor.status),
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

export async function createOrReuseTripRoom(
  sql: ReturnType<typeof createDb>,
  jobId: string,
  ownerPushToken?: string,
): Promise<{ room: TripRoomRow; created: boolean; memberCount: number }> {
  const journey = await loadJourneyLegs(sql, jobId);
  const expiresAt = deriveRoomExpiry(journey.legs);
  const existing = await loadRoomForJob(sql, jobId);
  if (existing) {
    const currentMembers = normalizeMembers(existing.members);
    const ownerUpdate = appendMemberIfNeeded(currentMembers, ownerPushToken, 'Owner', 'owner');
    const shouldRefreshExpiry = new Date(existing.expires_at).getTime() < Date.parse(expiresAt);
    if (ownerUpdate.added || shouldRefreshExpiry) {
      await sql`
        UPDATE trip_rooms
        SET members = ${JSON.stringify(ownerUpdate.members)}::jsonb,
            expires_at = ${expiresAt}
        WHERE id = ${existing.id}
      `;
      existing.members = ownerUpdate.members;
      existing.expires_at = expiresAt;
    }
    return {
      room: existing,
      created: false,
      memberCount: ownerUpdate.added ? ownerUpdate.members.length : currentMembers.length,
    };
  }

  const shareToken = makeShareToken();
  const members = ownerPushToken
    ? [{
        pushToken: ownerPushToken,
        role: 'owner',
        joinedAt: new Date().toISOString(),
      }]
    : [];

  const rows = await sql<TripRoomRow[]>`
    INSERT INTO trip_rooms (job_id, share_token, members, expires_at, created_at)
    VALUES (${jobId}, ${shareToken}, ${JSON.stringify(members)}::jsonb, ${expiresAt}, NOW())
    RETURNING id, job_id, members, expires_at, share_token
  `;

  return {
    room: rows[0]!,
    created: true,
    memberCount: members.length,
  };
}

// â”€â”€ POST /api/trip-rooms â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Create a trip room for a confirmed job. Idempotent â€” returns existing if already created.

tripRoomsRouter.post('/', async (c) => {
  if (!authCheck(c)) return c.json({ error: 'Unauthorized' }, 401);

  const { jobId, ownerPushToken } = await c.req.json<{ jobId: string; ownerPushToken?: string }>();
  if (!jobId) return c.json({ error: 'jobId required' }, 400);

  const sql = createDb(c.env);
  try {
    const { room, created, memberCount } = await createOrReuseTripRoom(sql, jobId, ownerPushToken);
    const jobRows = await sql<{ journey_id: string | null }[]>`
      SELECT metadata->>'journeyId' AS journey_id
      FROM payment_intents
      WHERE id = ${jobId}
      LIMIT 1
    `.catch(() => []);
    const journeyId = jobRows[0]?.journey_id ?? null;
    await sql`
      UPDATE payment_intents
      SET metadata = metadata || ${JSON.stringify({ shareToken: room.share_token })}::jsonb
      WHERE (
        id = ${jobId}
        OR (${journeyId ?? null} IS NOT NULL AND metadata->>'journeyId' = ${journeyId ?? ''})
      )
    `.catch(() => []);
    if (created) {
      broLog('trip_room_created', { jobId: room.job_id, shareToken: room.share_token });
    }
    return c.json({
      shareToken: room.share_token,
      roomId: room.id,
      created,
      memberCount,
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// â”€â”€ POST /api/trip-rooms/:token/join â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    const journey = await loadJourneyLegs(sql, room.job_id);
    const anchorMeta = journey.anchorMetadata ?? {};
    const journeyGraph = buildJourneyGraph(journey.legs, journey.journeyStatus ?? 'unknown');

    return c.json({
      ok: true,
      jobId: room.job_id,
      journeyId: journey.journeyId,
      memberCount: nextMembers.length,
      jobStatus: journey.journeyStatus ?? null,
      trainDetails: anchorMeta.trainDetails ?? null,
      flightDetails: anchorMeta.flightDetails ?? null,
      bookingRef: anchorMeta.broRef ?? anchorMeta.bookingReference ?? null,
      legs: journey.legs,
      journeyGraph,
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// â”€â”€ GET /api/trip-rooms/:token â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    const journey   = await loadJourneyLegs(sql, room.job_id);
    const meta      = journey.anchorMetadata ?? {};
    const train     = meta.trainDetails ?? null;
    const flight    = meta.flightDetails ?? null;
    const members   = normalizeMembers(room.members);
    const journeyGraph = buildJourneyGraph(journey.legs, journey.journeyStatus ?? 'unknown');

    return c.json({
      shareToken:   token,
      jobId:        room.job_id,
      journeyId:    journey.journeyId,
      status:       journey.journeyStatus ?? 'unknown',
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
      legs: journey.legs,
      journeyGraph,
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// â”€â”€ GET /trip/:token â€” joinable HTML web view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Rendered without auth â€” for people who don't have the Bro app.
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
    const journey = await loadJourneyLegs(sql, room.job_id);
    const meta   = journey.anchorMetadata ?? {};
    const train  = meta.trainDetails ?? null;
    const flight = meta.flightDetails ?? null;
    const hotel  = meta.hotelDetails  ?? null;
    const status = journey.journeyStatus ?? 'unknown';
    const ref    = meta.broRef ?? meta.bookingReference ?? null;
    const journeyGraph = buildJourneyGraph(journey.legs, status);

    const html = tripRoomHtml({
      token,
      train,
      flight,
      hotel,
      status,
      ref,
      memberCount: normalizeMembers(room.members).length,
      legs: journey.legs,
      journeyGraph,
    });
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  } finally {
    await sql.end().catch(() => {});
  }
});

// â”€â”€ Internal: fan-out push to all room members â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Called by stripeWebhooks.ts (Darwin disruption polling) to notify all room members.

export async function fanOutToTripRoom(
  jobId: string,
  message: string,
  db: ReturnType<typeof createDb>,
): Promise<void> {
  try {
    const room = await loadRoomForJob(db, jobId);
    if (!room) return;
    if (new Date(room.expires_at) < new Date()) return;

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
    // Fire-and-forget â€” never block the main flow
  }
}

// â”€â”€ HTML templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function legModeStyle(mode: JourneyLegView['mode']): { icon: string; color: string; label: string } {
  switch (mode) {
    case 'rail': return { icon: '🚂', color: '#4ade80', label: 'Rail' };
    case 'bus': return { icon: '🚌', color: '#fb923c', label: 'Coach' };
    case 'flight': return { icon: '✈️', color: '#60a5fa', label: 'Flight' };
    case 'hotel': return { icon: '🏨', color: '#a78bfa', label: 'Hotel' };
    default: return { icon: '📍', color: '#94a3b8', label: 'Journey' };
  }
}
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
  hotel: any;
  status: string;
  ref: string | null;
  memberCount: number;
  legs?: JourneyLegView[];
  journeyGraph?: JourneyGraph;
}

function formatLegTime(value?: string | null): string {
  if (!value) return '';
  const iso = Date.parse(value);
  if (Number.isFinite(iso)) {
    return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
  }
  return value;
}

function tripRoomHtml({ token, train, flight, hotel, status, ref, memberCount, legs = [], journeyGraph }: TripHtmlParams): string {
  void token;

  function legDotColor(legStatus: string): string {
    if (['completed', 'confirmed', 'verified'].includes(legStatus)) return '#4ade80';
    if (['failed', 'expired', 'rejected'].includes(legStatus)) return '#f87171';
    return '#facc15';
  }

  const anchorLeg = legs[0] ?? null;
  const anchorMode: JourneyLegView['mode'] = anchorLeg?.mode
    ?? (flight ? 'flight' : hotel ? 'hotel' : train?.transportMode === 'bus' ? 'bus' : train ? 'rail' : 'other');
  const anchorModeMeta = legModeStyle(anchorMode);
  const statusSubject = anchorMode === 'hotel'
    ? 'Stay'
    : anchorMode === 'flight'
    ? 'Flight'
    : anchorMode === 'bus'
    ? 'Coach'
    : anchorMode === 'rail'
    ? 'Rail'
    : 'Journey';
  const statusLabel = status === 'completed'
    ? `${statusSubject} confirmed`
    : status === 'failed'
    ? `${statusSubject} failed`
    : `${statusSubject} securing`;
  const statusColor = status === 'completed' ? '#4ade80' : status === 'failed' ? '#f87171' : '#facc15';

  const anchorDeparture = anchorLeg?.departureTime
    ?? train?.departureDatetime
    ?? train?.departureTime
    ?? flight?.departureAt
    ?? null;
  const anchorDepartureMs = anchorDeparture ? Date.parse(anchorDeparture) : Number.NaN;
  const countdownWithin4Hours = ['rail', 'bus', 'flight'].includes(anchorMode)
    && Number.isFinite(anchorDepartureMs)
    && anchorDepartureMs > Date.now()
    && anchorDepartureMs - Date.now() <= 4 * 60 * 60 * 1000;
  const countdownWithin2Hours = countdownWithin4Hours && anchorDepartureMs - Date.now() <= 2 * 60 * 60 * 1000;
  const countdownIso = countdownWithin4Hours ? new Date(anchorDepartureMs).toISOString() : null;

  const modeBadge = `<span class="mode-badge" style="background:${anchorModeMeta.color}18;color:${anchorModeMeta.color};border:1px solid ${anchorModeMeta.color}30">${anchorModeMeta.icon} ${anchorModeMeta.label}</span>`;
  const transit = train ?? (anchorLeg && ['rail', 'bus'].includes(anchorLeg.mode)
    ? {
        origin: anchorLeg.from,
        destination: anchorLeg.to,
        departureTime: anchorLeg.departureTime,
        departureDatetime: anchorLeg.departureTime,
        arrivalTime: anchorLeg.arrivalTime,
        operator: anchorLeg.operator,
        platform: null,
        transportMode: anchorLeg.mode,
      }
    : null);
  const transitMode: JourneyLegView['mode'] = transit?.transportMode === 'bus' ? 'bus' : 'rail';
  const transitModeMeta = legModeStyle(transitMode);
  const timelineHtml = legs.length > 1
    ? `<div class="journey-summary">
        <div>
          <div class="summary-title">Journey summary</div>
          <div class="summary-subtitle">${legs.length} legs in this live trip room</div>
        </div>
        <span class="status-badge">${statusLabel}</span>
      </div>
      <div class="timeline">${legs.map((leg, index) => {
        const modeMeta = legModeStyle(leg.mode);
        const route = leg.from || leg.to ? `${leg.from ?? ''} &rarr; ${leg.to ?? ''}` : '';
        return `<div class="timeline-leg">
          <div class="timeline-leg-header">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span class="mode-badge" style="background:${modeMeta.color}18;color:${modeMeta.color};border:1px solid ${modeMeta.color}30">${modeMeta.icon} ${modeMeta.label}</span>
              <span class="timeline-index">Leg ${index + 1}</span>
            </div>
            <span class="leg-status-dot" style="background:${legDotColor(leg.status)}"></span>
          </div>
          <div class="timeline-label">${leg.operator ?? leg.label ?? modeMeta.label}</div>
          ${route ? `<div class="timeline-route">${route}</div>` : ''}
          ${(leg.departureTime || leg.arrivalTime) ? `<div class="timeline-time">${formatLegTime(leg.departureTime) || 'TBC'}${leg.arrivalTime ? ` &rarr; ${formatLegTime(leg.arrivalTime)}` : ''}</div>` : ''}
          ${leg.bookingRef ? `<div class="timeline-ref">Ref: ${leg.bookingRef}</div>` : ''}
        </div>`;
      }).join('')}</div>`
    : '';
  const graphSummaryHtml = journeyGraph && journeyGraph.changes.length > 0
    ? `<div class="graph-panel">
        <div class="graph-title">What changed</div>
        ${journeyGraph.changes.slice(0, 2).map((change) => `<div class="graph-change">
          <div class="graph-change-title">${change.title}</div>
          <div class="graph-change-body">${change.body}</div>
        </div>`).join('')}
      </div>`
    : '';

  let journeyHtml = '';
  if (legs.length <= 1) {
    if (flight) {
      const pnr = flight.pnr ?? ref ?? anchorLeg?.bookingRef ?? null;
      const route = flight.origin || flight.destination ? `${flight.origin ?? ''} &rarr; ${flight.destination ?? ''}` : '';
      const gate = flight.gate ?? flight.metadata?.gate ?? null;
      journeyHtml = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px">
          ${modeBadge}
          <span class="members">${memberCount} traveller${memberCount !== 1 ? 's' : ''}</span>
        </div>
        ${pnr ? `<div class="pnr-hero"><div class="pnr-hero-label">PNR / Booking ref</div><div class="pnr-hero-val">${pnr}</div></div>` : ''}
        ${route ? `<div class="hero-route">${route}</div>` : ''}
        <div class="row"><span class="label">Carrier</span><span class="val">${[flight.carrier, flight.flightNumber].filter(Boolean).join(' ')}</span></div>
        ${flight.departureAt ? `<div class="row"><span class="label">Departs</span><span class="val">${formatLegTime(flight.departureAt)}</span></div>` : ''}
        ${flight.arrivalAt ? `<div class="row"><span class="label">Arrives</span><span class="val">${formatLegTime(flight.arrivalAt)}</span></div>` : ''}
        ${gate ? `<div class="row"><span class="label">Gate</span><span class="val">${gate}</span></div>` : ''}
        ${countdownIso ? `<div id="countdown" class="countdown"></div>` : ''}
      `;
    } else if (hotel?.bestOption) {
      const hotelOption = hotel.bestOption;
      const hotelStars = Number(hotelOption.stars);
      journeyHtml = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px">
          ${modeBadge}
          <span class="members">${memberCount} traveller${memberCount !== 1 ? 's' : ''}</span>
        </div>
        <div class="hotel-name">${hotelOption.name ?? hotel.city ?? 'Hotel'}</div>
        ${hotel.city ? `<div class="timeline-route" style="margin-bottom:12px">${hotel.city}</div>` : ''}
        ${hotel.checkIn ? `<div class="row"><span class="label">Check-in</span><span class="val checkin-highlight">${hotel.checkIn}</span></div>` : ''}
        ${hotel.checkOut ? `<div class="row"><span class="label">Check-out</span><span class="val">${hotel.checkOut}</span></div>` : ''}
        ${(hotelOption.currency || hotelOption.ratePerNight) ? `<div class="row"><span class="label">Rate</span><span class="val">${hotelOption.currency ?? ''} ${hotelOption.ratePerNight ?? ''}/night</span></div>` : ''}
        ${Number.isFinite(hotelStars) && hotelStars > 0 ? `<div class="row"><span class="label">Stars</span><span class="val">${'★'.repeat(hotelStars)}</span></div>` : ''}
      `;
    } else if (transit) {
      const route = transit.origin || transit.destination ? `${transit.origin ?? ''} &rarr; ${transit.destination ?? ''}` : '';
      const departure = transit.departureDatetime ?? transit.departureTime ?? null;
      journeyHtml = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px">
          ${modeBadge}
          <span class="members">${memberCount} traveller${memberCount !== 1 ? 's' : ''}</span>
        </div>
        ${route ? `<div class="hero-route">${transitModeMeta.icon} ${route}</div>` : ''}
        ${departure ? `<div class="row"><span class="label">Departs</span><span class="val">${formatLegTime(departure)}</span></div>` : ''}
        ${transit.arrivalTime ? `<div class="row"><span class="label">Arrives</span><span class="val">${formatLegTime(transit.arrivalTime)}</span></div>` : ''}
        ${transit.platform ? `<div class="row"><span class="label">Platform</span><span class="val" style="color:${transitModeMeta.color};font-weight:700">${transit.platform}</span></div>` : ''}
        ${transit.operator ? `<div class="row"><span class="label">Operator</span><span class="val">${transit.operator}</span></div>` : ''}
        ${(ref ?? anchorLeg?.bookingRef) ? `<div class="row"><span class="label">Ref</span><span class="val">${ref ?? anchorLeg?.bookingRef}</span></div>` : ''}
        ${countdownWithin2Hours ? `<div id="countdown" class="countdown"></div>` : ''}
      `;
    } else if (anchorLeg) {
      const route = anchorLeg.from || anchorLeg.to ? `${anchorLeg.from ?? ''} &rarr; ${anchorLeg.to ?? ''}` : '';
      journeyHtml = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px">
          ${modeBadge}
          <span class="members">${memberCount} traveller${memberCount !== 1 ? 's' : ''}</span>
        </div>
        ${anchorLeg.label ? `<div class="hero-route">${anchorLeg.label}</div>` : ''}
        ${route ? `<div class="row"><span class="label">Route</span><span class="val">${route}</span></div>` : ''}
        ${anchorLeg.departureTime ? `<div class="row"><span class="label">Departs</span><span class="val">${formatLegTime(anchorLeg.departureTime)}</span></div>` : ''}
        ${anchorLeg.arrivalTime ? `<div class="row"><span class="label">Arrives</span><span class="val">${formatLegTime(anchorLeg.arrivalTime)}</span></div>` : ''}
        ${anchorLeg.operator ? `<div class="row"><span class="label">Operator</span><span class="val">${anchorLeg.operator}</span></div>` : ''}
        ${anchorLeg.bookingRef ? `<div class="row"><span class="label">Ref</span><span class="val">${anchorLeg.bookingRef}</span></div>` : ''}
      `;
    }
  }

  const countdownScript = countdownIso ? `
<script>
  (function() {
    const dep = new Date('${countdownIso}').getTime();
    function tick() {
      const diff = dep - Date.now();
      const el = document.getElementById('countdown');
      if (!el) return;
      if (diff <= 0) { el.textContent = 'Departing now'; return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      el.textContent = h > 0 ? (h + 'h ' + m + 'm to departure') : (m + 'm ' + s + 's to departure');
      setTimeout(tick, 1000);
    }
    tick();
  })();
</script>` : '';

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
    .hero-route{font-size:16px;font-weight:700;color:#f8fafc;margin-bottom:12px}
    .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1e293b20}
    .row:last-child{border-bottom:none}
    .label{font-size:13px;color:#94a3b8}
    .val{font-size:13px;color:#f8fafc;font-weight:500;text-align:right;max-width:60%}
    .journey-summary{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
    .summary-title{font-size:14px;font-weight:700;color:#f8fafc}
    .summary-subtitle{font-size:12px;color:#94a3b8;margin-top:3px}
    .timeline{display:grid;gap:10px;margin-top:4px}
    .timeline-leg{background:#0b1220;border:1px solid #1e293b;border-radius:10px;padding:12px}
    .timeline-index{font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px}
    .timeline-label{font-size:13px;font-weight:600;color:#f8fafc;margin-bottom:4px}
    .timeline-route,.timeline-time{font-size:12px;color:#94a3b8}
    .ref{background:#052e16;border:1px solid #166534;border-radius:8px;padding:12px 16px;text-align:center;margin-bottom:16px}
    .ref-label{font-size:11px;color:#4ade80;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px}
    .ref-val{font-size:22px;font-weight:700;letter-spacing:4px;color:#f8fafc}
    .footer{text-align:center;font-size:12px;color:#475569;margin-top:24px}
    .footer a{color:#4ade80;text-decoration:none}
    .refresh{font-size:11px;color:#475569;text-align:center;margin-top:8px}
    .mode-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;padding:3px 8px;border-radius:12px;text-transform:uppercase;letter-spacing:.5px}
    .leg-status-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-left:6px;vertical-align:middle}
    .timeline-leg-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
    .timeline-ref{font-size:11px;color:#475569;margin-top:4px}
    .pnr-hero{background:#052e16;border:1px solid #166534;border-radius:8px;padding:10px 14px;text-align:center;margin-bottom:14px}
    .pnr-hero-label{font-size:10px;color:#4ade80;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px}
    .pnr-hero-val{font-size:24px;font-weight:700;letter-spacing:5px;color:#f8fafc}
    .countdown{font-size:13px;color:#facc15;font-weight:600;margin-top:8px;text-align:center}
    .hotel-name{font-size:16px;font-weight:700;color:#f8fafc;margin-bottom:4px}
    .checkin-highlight{color:#a78bfa;font-weight:600}
    .graph-panel{background:#0b1220;border:1px solid #1e293b;border-radius:10px;padding:12px;margin-bottom:14px}
    .graph-title{font-size:12px;font-weight:700;color:#cbd5e1;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px}
    .graph-change + .graph-change{margin-top:10px;padding-top:10px;border-top:1px solid #1e293b}
    .graph-change-title{font-size:13px;font-weight:600;color:#f8fafc;margin-bottom:4px}
    .graph-change-body{font-size:12px;color:#94a3b8;line-height:1.4}
  </style>
</head>
<body>
  <div class="header"><div class="dot"></div><div class="brand">bro</div></div>

  ${(ref && legs.length <= 1 && !flight) ? `<div class="ref"><div class="ref-label">Booking ref</div><div class="ref-val">${ref}</div></div>` : ''}

  <div class="card">
    ${legs.length <= 1 ? `<div class="status-row">
      <span class="status-badge">${statusLabel}</span>
      ${modeBadge}
    </div>` : `<div style="display:flex;justify-content:flex-end;margin-bottom:16px"><span class="members">${memberCount} traveller${memberCount !== 1 ? 's' : ''}</span></div>`}
    ${graphSummaryHtml}
    ${legs.length > 1 ? timelineHtml : (journeyHtml || '<div style="color:#94a3b8;font-size:14px">Journey details loading…</div>')}
  </div>

  <div class="footer">
    Managed by <a href="https://bro.app">Bro</a> · Live trip view
  </div>
  <div class="refresh">Refreshes automatically every 30 seconds</div>
  ${countdownScript}
</body>
</html>`;
}
