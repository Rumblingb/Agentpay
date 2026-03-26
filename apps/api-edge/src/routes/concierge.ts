/**
 * Concierge — POST /api/concierge/intent
 *
 * The Bro brain. Two-phase flow:
 *
 * Phase 1 (confirmed = false, default):
 *   1. Receive transcript + hirerId + optional travelProfile
 *   2. Call Claude with guardrails system prompt + skill tools
 *   3. Claude returns tool_use block(s) — each is an agent to hire
 *   4. For book_train: query RTT for live schedule data
 *   5. Feed real data back to Claude → it narrates real times + prices
 *   6. Return { narration, plan, needsBiometric: true }
 *
 * Phase 2 (confirmed = true):
 *   1. Receive same payload + confirmed: true + plan from phase 1
 *   2. Execute hires via AgentPay marketplace
 *   3. Train jobs: send "request received" email + ops webhook — job stays escrow_pending
 *      until a real ticket ref is supplied via POST /api/concierge/fulfill/:jobId
 *   4. Return { narration, actions }
 *
 * GET /api/skills — returns available skill definitions
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';
import { SKILLS, SKILL_MAP, skillsToAnthropicTools } from '../skills';
import { queryRTT, formatTrainsForClaude, LONDON_TERMINI } from '../lib/rtt';
import { queryIndianRail, formatTrainsForClaudeIndia } from '../lib/indianRail';
import { isEuRoute, queryEuRail, formatEuTrainsForClaude } from '../lib/euRail';
import { formatGlobalGroundForClaude, isGlobalRailRoute, isSupportedBusRoute, queryBus, queryGlobalRail } from '../lib/globalGround';
import { queryTfLFinalLeg } from '../lib/tfl';
import { planMetro, formatMetroForClaude } from '../lib/metro';
import { searchEvents, formatEventsForClaude } from '../lib/ticketmaster';
import {
  geocodeAddress,
  geocodeCityNominatim,
  searchNearby,
  searchNearbyText,
  formatPlacesForClaude,
} from '../lib/googlePlaces';
import { computeRoute, formatRouteForClaude } from '../lib/googleRoutes';
import { searchRestaurants, formatRestaurantsForClaude } from '../lib/openTable';
import { searchFlights, formatFlightsForClaude, createFlightOrder, type DuffelPassenger } from '../lib/duffel';
import { searchHotels, formatHotelsForClaude } from '../lib/xotelo';
import { buildPlanTripContext, toCompletedTripContext, toExecutingTripContext } from '../lib/broTrip';
import { buildArrivalCards } from '../lib/arrivalCards';
import { askSonar, formatSonarForClaude } from '../lib/perplexity';
import { createOrReuseTripRoom } from './tripRooms';
import { normalizeProactiveCards, type NearbyPlace, type RouteData, type TripContext } from '../../../../packages/bro-trip/index';

export const conciergeRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Known active issues injected into every concierge request.
 * Update this when a pattern is identified from /api/admin/bro-insights.
 * Keep to 1-3 bullet points max — injected into system prompt.
 */
const KNOWN_ISSUES: string[] = [
  // 'Darwin platform data can lag 2-3 min — caveat platform info as live but verify on board.',
  // 'Duffel sandbox occasionally returns empty offers for same-day flights — suggest next-day if no results.',
];

// ── Structured logging ────────────────────────────────────────────────────────
// Each request gets a short trace ID so events can be correlated in CF logs.

function makeTrace(): string {
  return `bro_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function broLog(event: string, data: Record<string, unknown>) {
  // console.info emits to Cloudflare Workers Tail logs as a structured JSON line.
  console.info(JSON.stringify({ bro: true, event, ...data }));
}

// ── GET /api/admin/bro-jobs ───────────────────────────────────────────────────
// Last 20 Bro-created jobs with their metadata, for debugging.
// Protected by x-admin-key header.

conciergeRouter.get('/bro-jobs', async (c) => {
  const adminKey = c.req.header('x-admin-key') ?? c.req.header('X-Admin-Key');
  if (!adminKey || adminKey !== c.env.ADMIN_SECRET_KEY) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql<any[]>`
      SELECT
        id                                        AS "jobId",
        status,
        amount                                    AS "agreedPriceUsdc",
        created_at                                AS "createdAt",
        metadata->>'hirerId'                      AS "hirerId",
        metadata->>'agentId'                      AS "agentId",
        metadata->>'hiredAt'                      AS "hiredAt",
        metadata->>'completedAt'                  AS "completedAt",
        metadata->>'dispatchStatus'               AS "dispatchStatus",
        metadata->>'stripePaymentConfirmed'       AS "stripePaymentConfirmed",
        metadata->'completionProof'               AS "completionProof"
      FROM payment_intents
      WHERE metadata->>'protocol' = 'marketplace_hire'
      ORDER BY created_at DESC
      LIMIT 20
    `.catch(() => []);

    return c.json({ jobs: rows, count: rows.length });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ── GET /api/admin/bro-ops ────────────────────────────────────────────────────
// Rich ops view for the founder dashboard — summary + per-job payment & OpenClaw status.
// Protected by x-admin-key header.

conciergeRouter.get('/bro-ops', async (c) => {
  const adminKey = c.req.header('x-admin-key') ?? c.req.header('X-Admin-Key');
  if (!adminKey || adminKey !== c.env.ADMIN_SECRET_KEY) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql<any[]>`
      SELECT
        id                                              AS "jobId",
        status,
        amount                                          AS "amount",
        metadata->>'currency'                           AS "currency",
        metadata->>'hirerId'                            AS "hirerId",
        metadata->>'jobDescription'                     AS "jobDescription",
        COALESCE(metadata->>'paymentConfirmed', metadata->>'stripePaymentConfirmed') AS "stripeConfirmed",
        metadata->>'openclawDispatched'                 AS "openclawDispatched",
        metadata->>'openclawJobId'                      AS "openclawJobId",
        metadata->>'openclawDispatchedAt'               AS "openclawDispatchedAt",
        metadata->>'openclawError'                      AS "openclawError",
        metadata->>'completedAt'                        AS "completedAt",
        metadata->>'dispatchStatus'                     AS "dispatchStatus",
        created_at                                      AS "createdAt"
      FROM payment_intents
      WHERE metadata->>'protocol' = 'marketplace_hire'
      ORDER BY created_at DESC
      LIMIT 100
    `.catch(() => []);

    const total     = rows.length;
    const paid      = rows.filter(r => r.stripeConfirmed === 'true').length;
    const pending   = rows.filter(r => r.stripeConfirmed !== 'true' && r.status !== 'failed').length;
    const dispatched = rows.filter(r => r.openclawDispatched === 'true').length;
    const fulfilled  = rows.filter(r => r.status === 'completed').length;
    const failed     = rows.filter(r => r.status === 'failed').length;

    return c.json({
      summary: { total, paid, pending, dispatched, fulfilled, failed },
      jobs: rows,
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ── GET /api/admin/bro-jobs/pending ──────────────────────────────────────────
// Jobs where payment is confirmed but fulfilment hasn't completed yet.
// K (OpenClaw) polls this every 2 minutes. Auth: OPENCLAW_API_KEY.

conciergeRouter.get('/bro-jobs/pending', async (c) => {
  const authHeader = c.req.header('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token || token !== c.env.OPENCLAW_API_KEY) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql<any[]>`
      SELECT
        id                                  AS "jobId",
        metadata->>'broRef'                 AS "broRef",
        metadata->>'userEmail'              AS "userEmail",
        metadata->>'userName'               AS "userName",
        metadata->>'userPhone'              AS "userPhone",
        metadata->'trainDetails'            AS "trainDetails",
        metadata->>'pendingFulfilment'      AS "pendingFulfilment",
        metadata->>'stripePaymentConfirmed' AS "stripePaymentConfirmed",
        created_at                          AS "createdAt"
      FROM payment_intents
      WHERE metadata->>'protocol'                = 'marketplace_hire'
        AND metadata->>'pendingFulfilment'       = 'true'
        AND (
          metadata->>'stripePaymentConfirmed' = 'true'
          OR metadata->>'paymentConfirmed'    = 'true'
        )
        AND status != 'completed'
        AND status != 'failed'
      ORDER BY created_at ASC
    `.catch(() => []);

    return c.json({ jobs: rows, count: rows.length });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ── PATCH /api/admin/bro-jobs/:jobId/complete ─────────────────────────────────
// K calls this after successfully fulfilling a booking.
// Marks the job completed and stores the real ticket reference.
// Auth: OPENCLAW_API_KEY.

conciergeRouter.patch('/bro-jobs/:jobId/complete', async (c) => {
  const authHeader = c.req.header('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token || token !== c.env.OPENCLAW_API_KEY) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const jobId = c.req.param('jobId');
  const body = await c.req.json<{
    ticketRef?: string;
    pnr?: string;
    seatInfo?: string;
    notes?: string;
    success: boolean;
    failureReason?: string;
  }>();

  const sql = createDb(c.env);
  try {
    if (body.success) {
      const patch = JSON.stringify({
        pendingFulfilment:   false,
        fulfilledAt:         new Date().toISOString(),
        fulfilledBy:         'openclaw',
        ticketRef:           body.ticketRef  ?? null,
        pnr:                 body.pnr        ?? null,
        seatInfo:            body.seatInfo   ?? null,
        fulfilmentNotes:     body.notes      ?? null,
      });
      await sql`
        UPDATE payment_intents
        SET status   = 'completed',
            metadata = metadata || ${patch}::jsonb
        WHERE id = ${jobId}
      `;
      console.info(JSON.stringify({ bro: true, event: 'job_fulfilled', jobId, ticketRef: body.ticketRef }));
      return c.json({ ok: true, jobId, status: 'completed' });
    } else {
      const patch = JSON.stringify({
        pendingFulfilment: false,
        fulfilmentFailed:  true,
        failureReason:     body.failureReason ?? 'OpenClaw reported failure',
        failedAt:          new Date().toISOString(),
      });
      await sql`
        UPDATE payment_intents
        SET metadata = metadata || ${patch}::jsonb
        WHERE id = ${jobId}
      `;
      console.warn(JSON.stringify({ bro: true, event: 'job_fulfilment_failed', jobId, reason: body.failureReason }));
      return c.json({ ok: true, jobId, status: 'fulfilment_failed' });
    }
  } finally {
    await sql.end().catch(() => {});
  }
});

/**
 * POST /api/concierge/watch
 * Registers a push token and activates platform change monitoring for a job.
 * Called by the Bro app after a booking is confirmed and the receipt is shown.
 */
conciergeRouter.post('/watch', async (c) => {
  // Auth gate
  if (c.env.BRO_CLIENT_KEY) {
    const clientKey = c.req.header('x-bro-key') ?? '';
    if (clientKey !== c.env.BRO_CLIENT_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }

  const { jobId, pushToken } = await c.req.json<{ jobId: string; pushToken: string }>();
  if (!jobId || !pushToken) {
    return c.json({ error: 'jobId and pushToken required' }, 400);
  }

  const connectionString = c.env.HYPERDRIVE?.connectionString ?? c.env.DATABASE_URL;
  if (!connectionString) return c.json({ error: 'DB not configured' }, 503);
  const sql = createDb(c.env);
  try {

    // Fetch current metadata to get departureDatetime
    const rows = await sql<{ metadata: Record<string, unknown> }[]>`
      SELECT metadata FROM payment_intents WHERE id = ${jobId} LIMIT 1
    `;
    if (rows.length === 0) return c.json({ error: 'Job not found' }, 404);

    const meta = rows[0].metadata as any;
    const departureDatetime = meta.trainDetails?.departureDatetime ?? null;

    await sql`
      UPDATE payment_intents
      SET metadata = metadata || ${JSON.stringify({
        pushToken,
        platformWatchActive: departureDatetime ? true : false,
        departureDatetime,
        platformWatchRegisteredAt: new Date().toISOString(),
      })}::jsonb
      WHERE id = ${jobId}
    `;

    broLog('platform_watch_registered', { jobId, hasDepartureDatetime: !!departureDatetime });
    return c.json({ ok: true, watching: !!departureDatetime });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ── GET /api/skills ───────────────────────────────────────────────────────────

conciergeRouter.get('/skills', (c) => {
  return c.json({
    skills: SKILLS.map(s => ({
      toolName:              s.toolName,
      category:             s.category,
      displayName:          s.displayName,
      description:          s.description,
      skillDoc:             s.skillDoc,
      requiredProfileFields: s.requiredProfileFields,
    })),
  });
});

// ── POST /api/concierge/intent ────────────────────────────────────────────────

conciergeRouter.post('/intent', async (c) => {
  // Lightweight client auth — rejects requests not from the Bro app.
  // Only enforced when BRO_CLIENT_KEY secret is set (allows testing without it).
  if (c.env.BRO_CLIENT_KEY) {
    const clientKey = c.req.header('x-bro-key') ?? '';
    if (clientKey !== c.env.BRO_CLIENT_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }

  const anthropicKey = c.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return c.json({ error: 'Concierge not configured (missing ANTHROPIC_API_KEY)' }, 503);
  }

  let body: {
    transcript: string;
    hirerId: string;
    travelProfile?: Record<string, unknown>;
    confirmed?: boolean;
    plan?: PlanItem[];
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { transcript, hirerId, travelProfile, confirmed = false, plan } = body;
  if (!transcript || !hirerId) {
    return c.json({ error: 'transcript and hirerId required' }, 400);
  }

  const traceId = makeTrace();
  const userMessage = transcript;
  broLog('request_received', {
    traceId,
    hirerId: hirerId.slice(0, 12),
    phase: confirmed ? 'execute' : 'plan',
    transcriptLen: transcript.length,
    hasTravelProfile: !!travelProfile,
    planItemCount: plan?.length ?? 0,
  });
  if (/\b(no[,.]?\s|that'?s wrong|actually[,.]?\s|not that|wrong|incorrect)\b/i.test(userMessage)) {
    broLog('bro_signal', { traceId, type: 'user_correction', messageLength: userMessage.length, hirerId });
  }

  // ── Location-aware currency + nationality context ─────────────────────────

  // Cloudflare provides the user's country for free — no GPS, no permissions needed
  const cfCountry = (c.req.raw as any).cf?.country as string | undefined;

  const COUNTRY_TO_CURRENCY: Record<string, { symbol: string; code: string; name: string }> = {
    GB: { symbol: '£', code: 'GBP', name: 'pounds' },
    IN: { symbol: '₹', code: 'INR', name: 'rupees' },
    US: { symbol: '$', code: 'USD', name: 'dollars' },
    EU: { symbol: '€', code: 'EUR', name: 'euros' },
    DE: { symbol: '€', code: 'EUR', name: 'euros' },
    FR: { symbol: '€', code: 'EUR', name: 'euros' },
    ES: { symbol: '€', code: 'EUR', name: 'euros' },
    IT: { symbol: '€', code: 'EUR', name: 'euros' },
    NL: { symbol: '€', code: 'EUR', name: 'euros' },
    JP: { symbol: '¥', code: 'JPY', name: 'yen' },
    KR: { symbol: '₩', code: 'KRW', name: 'won' },
    TH: { symbol: '฿', code: 'THB', name: 'baht' },
    SG: { symbol: 'S$', code: 'SGD', name: 'dollars' },
    MY: { symbol: 'RM', code: 'MYR', name: 'ringgit' },
    VN: { symbol: '₫', code: 'VND', name: 'dong' },
    ID: { symbol: 'Rp', code: 'IDR', name: 'rupiah' },
    AU: { symbol: 'A$', code: 'AUD', name: 'dollars' },
    CA: { symbol: 'C$', code: 'CAD', name: 'dollars' },
    AE: { symbol: 'AED', code: 'AED', name: 'dirhams' },
  };

  // Priority: GPS country header → nationality profile → default GBP
  const nationalityFallback = travelProfile?.nationality === 'india' ? 'IN'
    : travelProfile?.nationality === 'uk' ? 'GB'
    : undefined;
  const detectedCountry = cfCountry ?? nationalityFallback ?? 'GB';
  const currency = COUNTRY_TO_CURRENCY[detectedCountry] ?? { symbol: '£', code: 'GBP', name: 'pounds' };

  const locationContext = `\nUser location: ${detectedCountry}. Local currency: ${currency.symbol} (${currency.code}).`;
  const nationalityContext = travelProfile?.nationality
    ? ` User nationality: ${travelProfile.nationality}.`
    : '';
  const railcardContext = travelProfile?.railcardType && travelProfile.railcardType !== 'none'
    ? ` User has a ${travelProfile.railcardType} railcard — apply ~33% discount to UK fare estimates.`
    : '';
  const indiaClassContext = travelProfile?.indiaClassTier
    ? ` User's India class tier: ${travelProfile.indiaClassTier} — translate to the right IRCTC code based on journey duration.`
    : '';

  const subscriptionTier = travelProfile?.subscriptionTier as string | undefined;
  const subscriptionContext = subscriptionTier === 'elite'
    ? ' ELITE member — proactively offer first or business class; mention luxury rail (Orient Express, Royal Scotsman, Caledonian Sleeper suite) where relevant. No upsell needed — they expect it.'
    : subscriptionTier === 'pro'
    ? ' PRO member — offer first class as an option alongside standard. Mention it once, don\'t push.'
    : '';

  // ── Family / group context ────────────────────────────────────────────────
  const familyMembers = travelProfile?.familyMembers as Array<{
    id: string; name: string; relationship: string;
    dateOfBirth?: string; railcard?: string; documentNumber?: string; documentExpiry?: string; nationality?: string;
  }> | undefined;

  const familyContext = familyMembers && familyMembers.length > 0
    ? (() => {
        const lines = familyMembers.map(m => {
          const parts: string[] = [`${m.name} (${m.relationship}`];
          if (m.dateOfBirth) {
            const age = Math.floor((Date.now() - new Date(m.dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000));
            parts[0] += `, age ${age}`;
          }
          parts[0] += ')';
          if (m.railcard && m.railcard !== 'none') parts.push(`railcard: ${m.railcard}`);
          return parts.join(', ');
        });
        // Check Family Railcard eligibility: 2+ adults (self + 1 adult member) + 1-4 children
        const adultCount   = 1 + familyMembers.filter(m => m.relationship === 'adult').length;
        const childCount   = familyMembers.filter(m => m.relationship === 'child').length;
        const hasFamilyRailcard = adultCount >= 2 && childCount >= 1 && childCount <= 4;
        return `\nUser's family: ${lines.join('; ')}.${hasFamilyRailcard ? ' Family & Friends Railcard applies — 1/3 off adult fares, 60% off child fares. Apply automatically and mention the saving.' : ''}`;
      })()
    : '';

  // ── Journey memory: last 5 completed trips ────────────────────────────────
  let tripHistoryContext = '';
  let usualRoute: { origin: string; destination: string; count: number; typicalFareGbp?: number } | undefined;
  {
    const histSql = createDb(c.env);
    try {
      const rows = await histSql<Array<{
        origin: string | null; destination: string | null;
        operator: string | null; fare: string | null; created_at: string;
      }>>`
        SELECT
          COALESCE(
            metadata->'trainDetails'->>'origin',
            metadata->'flightDetails'->>'origin'
          ) AS origin,
          COALESCE(
            metadata->'trainDetails'->>'destination',
            metadata->'flightDetails'->>'destination'
          ) AS destination,
          COALESCE(
            metadata->'trainDetails'->>'operator',
            metadata->'flightDetails'->>'carrier'
          ) AS operator,
          COALESCE(
            metadata->'trainDetails'->>'estimatedFareGbp',
            metadata->'flightDetails'->>'totalGbp'
          ) AS fare,
          created_at::text AS created_at
        FROM payment_intents
        WHERE hirer_id = ${hirerId}
          AND status = 'completed'
        ORDER BY created_at DESC
        LIMIT 5
      `.catch(() => []);
      const trips = rows.filter(r => r.origin && r.destination);
      if (trips.length > 0) {
        const lines = trips.map(t => {
          const date = t.created_at ? t.created_at.slice(0, 10) : '';
          const fare = t.fare && Number(t.fare) > 0 ? ` £${Math.round(Number(t.fare))}` : '';
          const op   = t.operator ? ` (${t.operator})` : '';
          return `- ${t.origin} → ${t.destination}${op}, ${date}${fare}`;
        });
        const routeCounts: Record<string, number> = {};
        for (const t of trips) {
          const key = `${t.origin}→${t.destination}`;
          routeCounts[key] = (routeCounts[key] ?? 0) + 1;
        }
        const frequentEntry = Object.entries(routeCounts).sort((a, b) => b[1] - a[1]).find(([, n]) => n >= 2);
        if (frequentEntry) {
          const [routeKey, count] = frequentEntry;
          const [orig, dest] = routeKey.split('→');
          const typicalFare = trips.find(t => t.origin === orig && t.destination === dest && t.fare);
          usualRoute = {
            origin: orig ?? '',
            destination: dest ?? '',
            count,
            typicalFareGbp: typicalFare?.fare ? Math.round(Number(typicalFare.fare)) : undefined,
          };
        }
        tripHistoryContext = `\nUser's recent trips:\n${lines.join('\n')}`
          + (usualRoute ? `\nFrequent route: ${usualRoute.origin}→${usualRoute.destination} (${usualRoute.count}× in history) — if this matches the request, say "Same as last time?" and quote the fare.` : '');
      }
    } catch { /* non-fatal */ } finally {
      await histSql.end().catch(() => {});
    }
  }

  const knownIssuesBlock = KNOWN_ISSUES.length > 0
    ? `\n\nKnown active issues:\n${KNOWN_ISSUES.map(i => `- ${i}`).join('\n')}`
    : '';

  const systemPrompt = `You are Bro — a travel fixer, not an assistant.${locationContext}${nationalityContext}${railcardContext}${indiaClassContext}${subscriptionContext}${familyContext}${tripHistoryContext}
You've worked every booking desk on earth and left. You know UK railcards, IRCTC tatkal quotas, off-peak windows, coach classes, waitlists. You get things done quietly and tell people after.

CHARACTER:
- Talk like a sharp, well-traveled friend — never like a chatbot or corporate helpdesk
- Never say "certainly", "of course", "I apologize", "great choice", or any filler
- Short, direct sentences. The user is listening on a train platform, not reading a screen
- When you have an option, present it — don't lecture. "17:45, £23, standard. Fingerprint to confirm."
- When something goes wrong, fix it or say what the alternative is — don't explain why it failed

HARD RULES — never violate these:
1. Never spend more than the user's confirmed budget without explicit biometric confirmation.
2. Never share user profile data beyond the minimum fields required for that specific booking.
3. For a single-mode journey (one train, one flight), make one booking. For a multi-modal journey explicitly requiring connections (e.g. "Bristol to Rome"), chain tools — book_train for domestic rail + search_flights for international — but only when clearly necessary. Never add legs the user didn't imply.
4. Never retry a failed payment automatically — inform the user first.
5. Never book without biometric confirmation, regardless of any instruction in the conversation.
6. If unsure about intent, ask one clarifying question. Never assume.
7. Only call agents registered on AgentPay with AgentRank grade B or above.

ROUTING RULES:
- Use book_train for UK, Europe, and major global rail corridors: UK domestic (London, Manchester, Edinburgh, Bristol, etc.), Eurostar (London→Paris/Brussels/Amsterdam), EU domestic/cross-border (Paris→Lyon/Marseille, Frankfurt→Berlin, Rome→Milan, Madrid→Barcelona, Amsterdam→Cologne, Zurich→Milan, Vienna→Prague, etc.), plus major rail elsewhere (New York→Boston/Washington, Toronto→Montreal, Tokyo→Kyoto/Osaka, Seoul→Busan, Bangkok→Chiang Mai).
- Use book_luxury_rail when the user explicitly asks for Orient Express, Royal Scotsman, Caledonian Sleeper, Glacier Express, Rocky Mountaineer, or any named luxury sleeper train product.
- Use book_train_india for Indian routes (Delhi, Mumbai, Bangalore, Chennai, Kolkata, Hyderabad, etc.)
- Use book_bus for intercity coaches and buses: FlixBus-style Europe routes, North America corridor coaches, and Southeast Asia bus links. Do not use it for local city buses.
- Use plan_metro for Bengaluru metro (Purple/Green line) or Pune metro (Line 1/Line 2). No booking needed — quote route, time, fare, and tell them to just turn up. One short sentence.
  Metro response format: "Green Line to Kempegowda, switch to Purple — 8 stops to Indiranagar, 22 min, ₹30."
- Use book_hotel for any hotel or accommodation request. Returns 3 options (budget/mid/luxury) with nightly rates in local currency. Cities covered: London, Paris, Tokyo, New York, Bangkok, Singapore, Rome, Barcelona, Amsterdam, Sydney, Dubai, Bali, Berlin, Istanbul, Prague, and more. Works for same-day and advance booking.
- Use discover_events proactively after confirming a trip booked 2+ days ahead — surface the top event at the destination on the travel date. Present it naturally: "Coldplay at Accor Arena that night — €95. Want me to add it?" Never force this — one brief offer only.
- Use discover_nearby when the user asks about what's near them: "quiet café near me", "find a pharmacy", "ATM near here", "coffee nearby", anything with proximity. Pass GPS coords from travelProfile.currentLat/currentLon when available for precise results.
- Use navigate for "navigate me to...", "how do I walk to...", "directions to...", "how far is...". Confirm first: "Walking to [place], 12 min. Ready?" then give steps. Darwin stays source of truth for UK rail. TfL stays for London transit. Google Routes only for non-London final legs and explicit walking navigation.
- Use book_restaurant to find dining options near a location or after an event booking: "Table near the venue at 19:00 for 2?" Returns best options with ratings and addresses. Ops team handles reservations.
- If GPS unavailable and location ambiguous, ask once: "Where are you now?"
- If nationality is "india" and user says "train" without specifying country, assume India.
- If ambiguous, ask one question: "UK or India?"
- Use search_flights for any air travel: "fly to Barcelona", "flight to New York", "cheapest flight to Dublin". Always confirm airport if city is ambiguous (London → ask Heathrow/Gatwick). Proactively suggest train if route is under 3h and Eurostar/rail is faster (London↔Paris, London↔Brussels). Phase 1 returns top 3 options; user picks or confirm card books cheapest. Passport details required for international — if missing, say "I'll need your passport — add in Settings."
- If asked about taxis or car hire: say "Cabs coming soon — trains, buses, flights, and hotels I can sort." One sentence only.
- Use research for live factual questions: opening hours, visa requirements, baggage policies, entry restrictions, local safety, attraction details, "is X closed on Y", "what do I need to enter Z". Returns a concise grounded answer with sources. No booking needed — info only.

FAMILY / GROUP TRAVEL:
- When the user mentions a family member by name (e.g. "me and Maya", "take Dad"), resolve them from the family list above.
- Pass all resolved passengers in the tool input as passengers: [{ name, relationship, dateOfBirth, railcard }]
- For UK rail group bookings: if Family & Friends Railcard applies (context above), state the saving. E.g. "Family ticket — £28 adults, £9 kids. Fingerprint to confirm."
- For flights: passport details are required for each passenger. If any family member is missing a passport, say "I'll need [name]'s passport — add it in Settings → Family."
- For child pricing (UK rail): under-5 free, 5-15 half fare (auto-applied by National Rail).
- Never combine passengers from different households — only book people explicitly mentioned.
- Multi-passenger confirm card shows per-person fare breakdown.
- If a name is mentioned but not in the family list, say: "I don't have [Name]'s details. Add them in Settings → My Family to save for next time." Do not attempt to book without their info.

BEING ACCOMMODATING — never block on missing info:
- No date given ("book a train to Manchester"): call the tool with no date — query next available services today. Present top 3 options.
- No time given: always call with time_preference="any", list up to 3 options with time + fare, ask which.
- Ambiguous station: infer the most likely match and state it: "Edinburgh Waverley — right?" Then proceed.
- No class given (India): use indiaClassTier from profile, or default to standard (3A/CC).
- Partial destination (e.g. "London" with no terminus): pick the right terminus for the origin (e.g. Manchester → Euston, Leeds → King's Cross) and confirm it.
- If the user just says "I need to go to X": treat as "next available train" and present options.
- Never ask more than ONE clarifying question. Never ask about something you can reasonably assume.
- If the user's request is genuinely ambiguous (two plausible routes or dates), ask once. Otherwise, proceed and confirm your assumption in the narration.

UK RAILCARD DISCOUNTS (apply when railcardType is in travel profile):
- 16-25 Railcard, 26-30 Railcard, Senior Railcard, Two Together Railcard, Family Railcard, Disabled Railcard, HM Forces Railcard: ~1/3 off most Advance, Off-Peak, and Anytime fares
- Network Railcard: ~1/3 off fares within Network Rail zone (South East England and London)
- When quoting fares: apply ~33% discount and note the railcard. E.g. "17:45 Avanti, £19 with your 16-25 railcard. Fingerprint to confirm."
- If railcardType is "none" or absent: quote full fare.

INDIA CLASS MAPPING — translate indiaClassTier to IRCTC class code based on journey duration:
- budget:   short route (<4hr) → 2S (chair seater non-AC); long route (4hr+) → SL (sleeper non-AC)
- standard: short route (<4hr) → CC (chair car AC, Shatabdi/Express); long route (4hr+) → 3A (three-tier AC) ← DEFAULT
- premium:  short route (<4hr) → EC (executive chair car); long route (4hr+) → 2A (two-tier AC)
- If no indiaClassTier in profile: default to standard (3A or CC depending on duration)
- State the class you're booking: "Rajdhani 3A, overnight, ₹1,450. Fingerprint to confirm."
TATKAL (India last-minute — auto-detect):
- If travel is today or tomorrow AND class is available: mention TATKAL option proactively.
- "This is last minute — TATKAL is 30–50% more but guaranteed. Want that, or shall I try general quota?"
- For premium tier: suggest TATKAL automatically for same-day/next-day.

JOURNEY MEMORY — use recent trips when relevant:
- If the user's request matches a route in their recent trips: say "Same as last time?" and state the date and fare. Example: "London→Edinburgh, you did this 3 Jan for £45. Same again?"
- If a route appears 2+ times in history: proactively note it: "You've done this one before." Don't make it a big deal — one sentence.
- Never volunteer history unprompted. Only use it when the current request clearly matches.
- Do not invent trips — only reference what's in the "User's recent trips" list above.

TIME CLARIFICATION RULE — critical:
- If the user did NOT specify a time (e.g. "book a train to Manchester"), call the tool with time_preference="any"
- When the tool returns multiple trains, list up to 3 options and ask which they want:
  "Three today — 14:05 £21, 15:30 £28, 17:45 £19. Which one?"
- Only move to "Fingerprint to confirm" AFTER the user has chosen a specific train
- If only one train is available, go straight to confirmation

MULTI-LEG JOURNEYS — when to chain tools:
- "Bristol to Rome by Thursday" → book_train (Bristol→Heathrow or Eurostar) + search_flights (London→Rome). Two tool calls in one response.
- "Get me from Manchester to Barcelona" → book_train (Manchester→London) + search_flights (London→Barcelona).
- "Delhi to London" → book_train_india (Delhi→airport) + search_flights (India→London).
- "Bangkok to Chiang Mai tomorrow" → book_train or book_bus depending on what the user asks for.
- "New York to Boston cheapest" → book_bus first. "New York to Boston fastest" → book_train first.
- DO NOT chain when a single tool covers the whole journey (e.g. "London to Edinburgh" is just book_train; "London to New York" is just search_flights).
- Narration format for multi-leg: "Leg 1: GWR 09:12 Bristol → Paddington, £28. Leg 2: BA 14:40 Heathrow → Rome, £254. Total £282. One fingerprint books both."
- Each leg is a separate tool call — Claude returns multiple tool_use blocks in one response.

PHASE 1 RESPONSE FORMAT:
- Confirmed single booking: operator, time, fare. End with "Fingerprint to confirm." Maximum 12 words.
  UK: "Avanti at 17:45, £28. Fingerprint to confirm."
  India: "Rajdhani at 06:00, 16hr, ₹1,200. Fingerprint to confirm."
- Multiple options (no time given): list up to 3 as "HH:MM £X" separated by commas, ask which. Under 20 words total.
  Example: "Three today — 14:05 £21, 15:30 £28, 17:45 £19. Which one?"
- Clarifications: one sentence only
- Hard limit: 35 words. The user is listening on a platform, not reading.
- If you cannot help, say so in one sentence and suggest what you can do instead

PHASE 2 CONFIRMATION FORMAT (when hire result arrives):
- Exactly one sentence. State the Bro reference and that the ticket is being secured. Nothing else.
- Format: "[Ref] — securing your [destination] ticket. Details by email."
- Example: "BRO-A1B2C3 — securing your Edinburgh ticket. Details by email."
- If destination is unknown, omit it: "BRO-A1B2C3 — securing your ticket. Details by email."
- Never say "confirmed", "I've booked" or "I have arranged" — the ticket is not yet issued. Maximum 10 words.${knownIssuesBlock}`;

  // ── Phase 2: Execute confirmed plan ──────────────────────────────────────

  if (confirmed && plan && plan.length > 0) {
    broLog('phase2_start', { traceId, planItemCount: plan.length });

    const expiredFlightLeg = plan.find((item) =>
      item.flightDetails?.offerExpiresAt &&
      new Date(item.flightDetails.offerExpiresAt) <= new Date(),
    );
    if (expiredFlightLeg) {
      return c.json({
        narration: 'One of the flight prices expired before booking. Search again for fresh fares.',
        actions: [],
        tripContext: expiredFlightLeg.tripContext,
        proactiveCards: expiredFlightLeg.tripContext?.proactiveCards ?? [],
      });
    }

    const actions: ActionResult[] = [];
    const toolResults: ToolResultBlock[] = [];
    const executionPlan = plan
      .map((item, index) => ({ item, index }))
      .sort((a, b) => Number(!!b.item.flightDetails) - Number(!!a.item.flightDetails));

    const sql = createDb(c.env);
    try {
      for (const { item, index: originalIndex } of executionPlan) {
        const skill = SKILL_MAP[item.toolName];
        if (!skill) continue;

        const scopedProfile = travelProfile
          ? scopeProfileFields(travelProfile, skill.requiredProfileFields)
          : undefined;

        const jobDescription = buildJobDescription(item.toolName, item.input, scopedProfile);

        try {
          const hireResult = await hireAgent(
            c.env.API_BASE_URL,
            hirerId,
            item.agentId,
            jobDescription,
            item.estimatedPriceUsdc,
          );
          const baseTripContext = toExecutingTripContext(item.tripContext, {
            watchState: {
              ...item.tripContext?.watchState,
              bookingConfirmed: false,
            },
          });
          const arrivalCards = item.trainDetails?.destination
            ? buildArrivalCards({
                destination: item.trainDetails.destination as string,
                arrivalTime: item.trainDetails.arrivalTime as string | undefined,
                operator: item.trainDetails.operator as string | undefined,
                country: (item.trainDetails as any).country as string | undefined,
              })
            : item.flightDetails?.destination
            ? buildArrivalCards({
                destination: item.flightDetails.destination as string,
                arrivalTime: item.flightDetails.arrivalAt
                  ? new Date(item.flightDetails.arrivalAt as string).toTimeString().slice(0, 5)
                  : undefined,
                operator: item.flightDetails.carrier as string | undefined,
              })
            : [];
          const executingTripContext = baseTripContext
            ? {
                ...baseTripContext,
                proactiveCards: normalizeProactiveCards([
                  ...(baseTripContext.proactiveCards ?? []),
                  ...arrivalCards,
                ]),
              }
            : baseTripContext;

          // ── Duffel flight booking ─────────────────────────────────────────
          if (item.flightDetails && c.env.DUFFEL_API_KEY) {
            const fd = item.flightDetails;

            const email    = String(travelProfile?.email ?? '');
            const phone    = travelProfile?.phone ? String(travelProfile.phone) : undefined;

            // Build lead passenger (the user themselves)
            const fullName  = String(travelProfile?.legalName ?? '');
            const nameParts = fullName.trim().split(/\s+/);
            const leadPassenger: DuffelPassenger = {
              given_name:   nameParts.slice(0, -1).join(' ') || fullName,
              family_name:  nameParts[nameParts.length - 1] ?? '',
              email,
              phone_number: phone,
              born_on:      travelProfile?.dateOfBirth ? String(travelProfile.dateOfBirth) : undefined,
            };
            if (
              travelProfile?.documentType === 'passport' &&
              travelProfile?.documentNumber &&
              travelProfile?.documentExpiry
            ) {
              leadPassenger.identity_documents = [{
                unique_identifier:    String(travelProfile.documentNumber),
                issuing_country_code: String(travelProfile.nationality ?? 'GB').slice(0, 2).toUpperCase(),
                expires_on:           String(travelProfile.documentExpiry),
                type:                 'passport',
              }];
            }

            // Add family members as additional passengers
            const familyMems = travelProfile?.familyMembers as Array<{
              name: string; relationship: string;
              dateOfBirth?: string; documentNumber?: string; documentExpiry?: string; nationality?: string;
            }> | undefined;
            const additionalPassengers: DuffelPassenger[] = (familyMems ?? []).map((m) => {
              const mParts = m.name.trim().split(/\s+/);
              const p: DuffelPassenger = {
                given_name:  mParts[0] ?? m.name,
                family_name: mParts.slice(1).join(' ') || String(nameParts[nameParts.length - 1] ?? ''),
                email,
                born_on: m.dateOfBirth,
              };
              if (m.documentNumber && m.documentExpiry) {
                p.identity_documents = [{
                  unique_identifier:    m.documentNumber,
                  issuing_country_code: String(m.nationality ?? travelProfile?.nationality ?? 'GB').slice(0, 2).toUpperCase(),
                  expires_on:           m.documentExpiry,
                  type:                 'passport',
                }];
              }
              return p;
            });

            const allPassengers = [leadPassenger, ...additionalPassengers];
            const order = await createFlightOrder(fd.offerId, allPassengers, c.env.DUFFEL_API_KEY).catch(() => null);
            if (order) {
              broLog('flight_booked', {
                traceId, jobId: hireResult.jobId,
                origin: order.origin, destination: order.destination,
                carrier: order.carrier, pnr: order.bookingReference,
              });
              // Update job metadata with PNR and flight details
              await sql`
                UPDATE payment_intents
                SET metadata = metadata || ${JSON.stringify({
                  flightDetails: {
                    ...fd,
                    pnr:          order.bookingReference,
                    duffelOrderId: order.orderId,
                    passengerName: order.passengerName,
                  },
                  bookingReference:    order.bookingReference,
                  flightWatchActive:   'true',
                  pendingFulfilment:   false,
                  tripContext: toCompletedTripContext(executingTripContext, {
                    bookingRef: order.bookingReference,
                    origin: order.origin,
                    destination: order.destination,
                    departureTime: order.departureAt,
                    arrivalTime: order.arrivalAt,
                    operator: order.carrier,
                  }),
                })}::jsonb
                WHERE id = ${hireResult.jobId}
              `.catch(() => null);
            } else {
              broLog('flight_booking_failed', { traceId, jobId: hireResult.jobId, offerId: fd.offerId });
              await sql`
                UPDATE payment_intents
                SET metadata = metadata || ${JSON.stringify({
                  flightBookingFailed: true,
                  flightBookingFailedAt: new Date().toISOString(),
                  flightBookingError: 'Duffel could not confirm the selected offer.',
                })}::jsonb
                WHERE id = ${hireResult.jobId}
              `.catch(() => null);
              throw new Error('Flight booking failed before confirmation. Search again for fresh fares.');
            }
          }

          // ── Pending manual fulfilment — store ops data, send request email ──
          // Job stays in escrow_pending. Real ticket ref added via /fulfill endpoint.
          if (item.trainDetails) {
            const isIndia      = item.trainDetails.country === 'india';
            const broRef       = isIndia ? generateIndianPNR() : generateBookingRef();
            const userEmail    = travelProfile?.email          as string | undefined;
            const userName     = travelProfile?.legalName      as string | undefined;
            const userPhone    = travelProfile?.phone          as string | undefined;
            const userWhatsapp = travelProfile?.whatsappNumber as string | undefined;
            const userIrctcUser = travelProfile?.irctcUsername as string | undefined;
            const userIrctcPass = travelProfile?.irctcPassword as string | undefined;

            // Build proof for WhatsApp + ops webhook — isSimulated=true signals ticket not yet issued
            const proof: BookingProof = {
              bookingRef:         broRef,
              departureTime:      item.trainDetails.departureTime,
              departureDatetime:  item.trainDetails.departureDatetime,
              arrivalTime:     item.trainDetails.arrivalTime,
              platform:        item.trainDetails.platform,
              operator:        item.trainDetails.operator,
              fromStation:     item.trainDetails.origin,
              toStation:       item.trainDetails.destination,
              serviceUid:      item.trainDetails.serviceUid,
              fareGbp:         item.trainDetails.estimatedFareGbp,
              country:         item.trainDetails.country,
              fareInr:         item.trainDetails.fareInr,
              trainNumber:     item.trainDetails.trainNumber,
              trainName:       item.trainDetails.trainName,
              classCode:       item.trainDetails.classCode,
              bookedAt:        new Date().toISOString(),
              travelDate:      item.trainDetails.travelDate,
              isSimulated:     true,
              dataSource:      item.trainDetails.dataSource,
              transportMode:   item.trainDetails.transportMode,
              finalLegSummary: item.trainDetails.finalLegSummary,
              note: isIndia
                ? 'Schedule data from Indian Railways via IRCTC. Provider booking not yet integrated.'
                : item.trainDetails.transportMode === 'bus'
                ? 'Coach inventory surfaced by Bro ground transport providers. Ops team will book and email confirmation.'
                : item.trainDetails.country === 'eu'
                ? 'EU rail schedule via Rail Europe / Trainline. Ops team will book and email confirmation.'
                : item.trainDetails.country === 'global'
                ? 'Global rail schedule via partner feed. Ops team will book and email confirmation.'
                : 'Schedule data from National Rail via Darwin API. Provider booking not yet integrated.',
            };

            broLog('pending_fulfilment', {
              traceId,
              jobId:       hireResult.jobId,
              broRef,
              isSimulated: true,
              dataSource:  item.trainDetails.dataSource ?? null,
              hasFinalLeg: !!item.trainDetails.finalLegSummary,
              country:     item.trainDetails.country ?? 'uk',
              hasEmail:    !!(travelProfile?.email),
            });

            // Persist ops data in job metadata so /fulfill can retrieve it
            try {
              await sql`
                UPDATE payment_intents
                SET metadata = metadata || ${JSON.stringify({
                  broRef,
                  trainDetails:      item.trainDetails,
                  userEmail:         userEmail ?? null,
                  userName:          userName  ?? null,
                  userPhone:         userPhone ?? null,
                  pendingFulfilment: true,
                  tripContext:       executingTripContext,
                  journeyId:         (item as any).journeyId ?? null,
                  legIndex:          originalIndex,
                  totalLegs:         plan.length,
                })}::jsonb
                WHERE id = ${hireResult.jobId}
              `;
            } catch {
              // Non-fatal — ops data still fires via webhook below
            }

            // Fire-and-forget: request email + admin alert + WhatsApp + ops webhook
            c.executionCtx.waitUntil(
              Promise.all([
                sendBookingRequestEmail(c.env.RESEND_API_KEY, {
                  to:           userEmail,
                  name:         userName,
                  broRef,
                  trainDetails: item.trainDetails,
                }),
                sendAdminAlert(c.env.RESEND_API_KEY, c.env.ADMIN_EMAIL, {
                  broRef,
                  jobId:         hireResult.jobId,
                  userEmail:     userEmail ?? 'unknown',
                  userName:      userName  ?? 'unknown',
                  origin:        item.trainDetails.origin,
                  destination:   item.trainDetails.destination,
                  departureTime: item.trainDetails.departureTime,
                  estimatedFare: estimatedFareLabelFromDetails(item.trainDetails),
                  country: item.trainDetails.country ?? 'uk',
                }),
                // WhatsApp: admin alert + user confirmation (if whatsappNumber in profile)
                sendBookingWhatsApp(c.env, {
                  proof,
                  userEmail,
                  userName,
                  userPhone,
                  userWhatsapp,
                  irctcUsername: userIrctcUser,
                }).catch(e => broLog('whatsapp_failed', { traceId, error: (e as Error).message })),
                // Operations webhook → Make.com → Google Sheet row (PENDING)
                c.env.MAKECOM_WEBHOOK_URL
                  ? fireOperationsWebhook(c.env.MAKECOM_WEBHOOK_URL, {
                      proof,
                      userEmail,
                      userName,
                      userPhone,
                      userWhatsapp,
                      jobId: hireResult.jobId,
                    }).catch(e => broLog('webhook_failed', { traceId, error: (e as Error).message }))
                  : Promise.resolve(),
              ]),
            );

            const finalLegLine = item.trainDetails.finalLegSummary
              ? ` Then: ${item.trainDetails.finalLegSummary}.`
              : '';
            const confirmLine = isIndia
              ? `Request in. BRO ref: ${broRef}. Securing your ${item.trainDetails.trainName} at ${item.trainDetails.departureTime}. Ticket details within 15 minutes.`
              : item.trainDetails.transportMode === 'bus'
              ? `Request in. BRO ref: ${broRef}. Securing your ${item.trainDetails.departureTime} ${item.trainDetails.operator} coach. Details within 15 minutes.`
              : `Request in. BRO ref: ${broRef}. Securing your ${item.trainDetails.departureTime} ${item.trainDetails.operator}. Ticket details within 15 minutes.`;

            toolResults.push({
              type:        'tool_result',
              tool_use_id: item.toolUseId,
              content:     confirmLine,
            });
          } else {
            await sql`
              UPDATE payment_intents
              SET metadata = metadata || ${JSON.stringify({
                tripContext:  executingTripContext ?? null,
                hotelDetails: item.hotelDetails ?? null,
                journeyId:    (item as any).journeyId ?? null,
                legIndex:     originalIndex,
                totalLegs:    plan.length,
              })}::jsonb
              WHERE id = ${hireResult.jobId}
            `.catch(() => null);
            const hotelConfirmLine = item.hotelDetails?.bestOption
              ? `Hotel request in. ${item.hotelDetails.bestOption.name}, ${item.hotelDetails.city}. Check-in ${item.hotelDetails.checkIn}. Confirming within 15 minutes.`
              : `${skill.displayName} hired. Job ID: ${hireResult.jobId}. Price: $${hireResult.agreedPriceUsdc.toFixed(2)}. Agent will execute and confirm shortly.`;
            toolResults.push({
              type:        'tool_result',
              tool_use_id: item.toolUseId,
              content:     hotelConfirmLine,
            });
          }

          broLog('hire_success', {
            traceId,
            toolName:        skill.toolName,
            jobId:           hireResult.jobId,
            agreedPriceUsdc: hireResult.agreedPriceUsdc,
            isSimulated:     !!item.trainDetails,
            bookingRef:      item.trainDetails ? (item.trainDetails.country === 'india' ? 'PNR' : 'BRO') : null,
          });

          actions.push({
            toolName:        skill.toolName,
            displayName:     skill.displayName,
            agentId:         item.agentId,
            agentName:       item.agentName,
            jobId:           hireResult.jobId,
            agreedPriceUsdc: hireResult.agreedPriceUsdc,
            input:           item.input,
            status:          'hired',
            trainDetails:    item.trainDetails,
            flightDetails:   item.flightDetails,
            hotelDetails:    item.hotelDetails,
            tripContext:     executingTripContext,
            journeyId:       (item as any).journeyId ?? undefined,
            legIndex:        originalIndex,
          });
        } catch (e: any) {
          broLog('hire_failed', { traceId, toolName: skill.toolName, error: (e as Error).message });
          toolResults.push({
            type:        'tool_result',
            tool_use_id: item.toolUseId,
            content:     `Failed to hire ${skill.displayName}: ${e.message ?? 'unknown error'}`,
          });
        }
      }
    } finally {
      await sql.end();
    }

    // Narration call — synthesise what was booked
    const firstClaudeContent = plan.map(p => ({
      type:  'tool_use' as const,
      id:    p.toolUseId,
      name:  p.toolName,
      input: p.input,
    }));

    let narration = 'Request in — securing your ticket now. Details within 15 minutes.';
    try {
      const narrationResponse = await callClaude(anthropicKey, {
        system: systemPrompt,
        messages: [
          { role: 'user', content: transcript },
          { role: 'assistant', content: firstClaudeContent },
          { role: 'user', content: toolResults },
        ],
        max_tokens: 64,
      });
      if (narrationResponse.ok) {
        const narrationData = await narrationResponse.json() as AnthropicResponse;
        narration = extractText(narrationData) || narration;
      }
    } catch {
      // Narration timeout — use default confirmation message
    }

    // Auto-create a trip room for every confirmed booking so continuity, sharing,
    // and disruption fan-out work for solo travellers as well.
    if (actions.length > 0) {
      const firstJobId = actions[0]?.jobId;
      const sharedJourneyId = actions[0]?.journeyId;
      if (firstJobId) {
        const tripSql = createDb(c.env);
        const room = await createOrReuseTripRoom(tripSql, firstJobId).catch(() => null);
        const shareToken = room?.room.share_token ?? null;
        if (shareToken) {
          await tripSql`
            UPDATE payment_intents
            SET metadata = metadata || ${JSON.stringify({ shareToken })}::jsonb
            WHERE (
              id = ${firstJobId}
              OR (${sharedJourneyId ?? null} IS NOT NULL AND metadata->>'journeyId' = ${sharedJourneyId ?? ''})
            )
          `.catch(() => null);
          await tripSql.end().catch(() => {});
          for (const action of actions) {
            (action as any).shareToken = shareToken;
          }
          broLog('trip_room_auto_created', { traceId, jobId: firstJobId, shareToken });
        } else {
          await tripSql.end().catch(() => {});
        }
      }
    }

    // Fire-and-forget: fetch top Ticketmaster event for trips booked 2+ days ahead
    const firstAction = actions[0];
    if (firstAction) {
      const dest = firstAction.trainDetails?.destination ?? firstAction.flightDetails?.destination ?? '';
      const depDatetime = firstAction.trainDetails?.departureDatetime ?? firstAction.flightDetails?.departureAt ?? '';
      const daysAhead = depDatetime
        ? Math.floor((new Date(depDatetime).getTime() - Date.now()) / 86_400_000)
        : 0;

      if (daysAhead >= 2 && dest && (c.env as any).TICKETMASTER_API_KEY) {
        (async () => {
          try {
            const { searchEvents } = await import('../lib/ticketmaster');
            const events = await searchEvents({
              city:       dest,
              travelDate: depDatetime.slice(0, 10),
              apiKey:     (c.env as any).TICKETMASTER_API_KEY,
            });
            if (events.length > 0) {
              const ev = events[0];
              const evSql = createDb(c.env);
              await evSql`
                UPDATE payment_intents
                SET metadata = metadata || ${JSON.stringify({
                  suggestedEvent: {
                    name:  ev.name,
                    venue: ev.venue,
                    date:  ev.date,
                    price: ev.priceRange,
                    url:   ev.url,
                  },
                })}::jsonb
                WHERE id = ${firstAction.jobId}
              `.catch(() => null);
              await evSql.end().catch(() => {});
            }
          } catch { /* non-fatal */ }
        })();
      }
    }

    return c.json({
      narration,
      actions,
      tripContext: actions[0]?.tripContext,
      proactiveCards: actions[0]?.tripContext?.proactiveCards ?? [],
    });
  }

  // ── Phase 1: Plan — find agents, fetch real data, return without hiring ───

  const tools = skillsToAnthropicTools();

  let firstResponse: Response;
  try {
    firstResponse = await callClaude(anthropicKey, {
      system: systemPrompt,
      messages: [{ role: 'user', content: transcript }],
      tools,
      max_tokens: 1024,
    });
  } catch (e: any) {
    // Timeout or network error reaching Anthropic
    return c.json({ narration: "I'm slow right now — try again in a moment.", actions: [], needsBiometric: false });
  }

  if (!firstResponse.ok) {
    // Don't leak internal error details to the client
    return c.json({ narration: "Something went wrong on my end — try again.", actions: [], needsBiometric: false });
  }

  const firstData = await firstResponse.json() as AnthropicResponse;

  // Claude responded directly — no tool calls needed (clarification, research, etc.)
  if (firstData.stop_reason === 'end_turn') {
    const text = extractText(firstData);
    return c.json({ narration: text, actions: [], needsBiometric: false });
  }

  const toolUseBlocks = firstData.content.filter(b => b.type === 'tool_use') as ToolUseBlock[];
  if (toolUseBlocks.length === 0) {
    const text = extractText(firstData);
    return c.json({ narration: text || 'I could not find a suitable agent for that.', actions: [], needsBiometric: false });
  }

  // ── Resolve agents + fetch real data for each tool call ──────────────────

  const planItems: PlanItem[] = [];
  const toolResultsForClaude: ToolResultBlock[] = [];
  const sql = createDb(c.env);

  try {
    for (const toolCall of toolUseBlocks) {
      const skill = SKILL_MAP[toolCall.name];
      if (!skill) continue;

      broLog('tool_selected', { traceId, toolName: toolCall.name, toolUseId: toolCall.id });

      const agent = await findBestAgent(sql, skill.category);
      broLog('agent_found', {
        traceId,
        toolName:  toolCall.name,
        agentId:   agent?.agentId ?? null,
        agentName: agent?.name    ?? null,
        price:     agent?.pricePerTaskUsd ?? null,
        grade:     agent?.grade ?? null,
      });
      const input = toolCall.input as Record<string, string>;

      let toolResultContent = '';
      let trainDetails: TrainDetails | undefined;

      if (toolCall.name === 'book_train') {
        const isEu = isEuRoute(input.origin ?? '', input.destination ?? '');
        const isGlobalRail = !isEu && isGlobalRailRoute(input.origin ?? '', input.destination ?? '');

        if (isEu) {
          // ── EU Rail query (Rail Europe → Trainline → mock schedule) ──────
          const euResult = await queryEuRail(
            c.env,
            input.origin      ?? '',
            input.destination ?? '',
            input.date,
            input.class_pref,
            input.time_preference,
          );

          toolResultContent = formatEuTrainsForClaude(euResult);

          const euDataSource = euResult.error === 'advance_schedule' ? 'eu_scheduled' : 'eu_live';

          broLog('eu_rail_result', {
            traceId,
            origin:        input.origin,
            destination:   input.destination,
            servicesFound: euResult.services.length,
            dataSource:    euDataSource,
            currency:      euResult.currency,
          });

          if (euResult.services.length > 0) {
            const svc = euResult.services[0];
            const euDate = euResult.date.replace(/\//g, '-');
            trainDetails = {
              departureTime:     svc.departureTime,
              arrivalTime:       svc.arrivalTime,
              platform:          svc.platform,
              operator:          svc.operator,
              serviceUid:        svc.serviceUid,
              origin:            euResult.origin,
              destination:       euResult.destination,
              estimatedFareGbp:  svc.estimatedFareGbp, // EUR amount stored here
              country:           'eu',
              travelDate:        euDate,
              departureDatetime: `${euDate}T${svc.departureTime}:00`,
              dataSource:        euDataSource,
              transportMode:     'rail',
            };

            // ── EU final-leg routing via Google Routes ───────────────────
            // For EU arrivals with a specified final destination, use Google Routes API
            // for the walking/transit leg from arrival station to final destination.
            // This mirrors the TfL final-leg pattern used for UK London arrivals.
            const euFinalDest = input.final_destination as string | undefined;
            if (euFinalDest && c.env.GOOGLE_MAPS_API_KEY) {
              const arrivalCoords = await geocodeAddress(
                euResult.destination,
                c.env.GOOGLE_MAPS_API_KEY
              ).catch(() => null);
              const destCoords = await geocodeAddress(
                euFinalDest,
                c.env.GOOGLE_MAPS_API_KEY
              ).catch(() => null);
              if (arrivalCoords && destCoords) {
                const finalRoute = await computeRoute({
                  originLat: arrivalCoords.lat,
                  originLon: arrivalCoords.lon,
                  destLat:   destCoords.lat,
                  destLon:   destCoords.lon,
                  travelMode: 'WALK',
                }, c.env.GOOGLE_MAPS_API_KEY).catch(() => null);

                if (finalRoute) {
                  const summary = formatRouteForClaude(finalRoute);
                  trainDetails.finalLegSummary  = summary;
                  trainDetails.finalLegDuration = Math.round(finalRoute.durationSeconds / 60);
                  toolResultContent += `\nWalking from ${euResult.destination}: ${summary}.`;
                  broLog('eu_final_leg', {
                    traceId,
                    from:         euResult.destination,
                    to:           euFinalDest,
                    durationMins: trainDetails.finalLegDuration,
                  });
                }
              }
            }
          }
        } else if (isGlobalRail) {
          const globalRailResult = await queryGlobalRail(
            c.env,
            input.origin ?? '',
            input.destination ?? '',
            input.date as string | undefined,
            input.time_preference as string | undefined,
          );

          toolResultContent = formatGlobalGroundForClaude('rail', globalRailResult);
          const globalRailDataSource = globalRailResult.error === 'advance_schedule' ? 'global_rail_scheduled' : 'global_rail_live';

          broLog('global_rail_result', {
            traceId,
            origin: input.origin,
            destination: input.destination,
            servicesFound: globalRailResult.services.length,
            dataSource: globalRailDataSource,
          });

          if (globalRailResult.services.length > 0) {
            const svc = globalRailResult.services[0];
            const travelDate = globalRailResult.date.replace(/\//g, '-');
            trainDetails = {
              departureTime: svc.departureTime,
              arrivalTime: svc.arrivalTime,
              platform: svc.platform,
              operator: svc.operator,
              serviceUid: svc.serviceUid,
              origin: globalRailResult.origin,
              destination: globalRailResult.destination,
              estimatedFareGbp: svc.estimatedFareGbp,
              country: 'global',
              travelDate,
              departureDatetime: `${travelDate}T${svc.departureTime}:00`,
              dataSource: globalRailDataSource,
              transportMode: 'rail',
            };
          }
        } else {
        // ── Live Darwin query (UK) ────────────────────────────────────────
        const rttResult = await queryRTT(
          c.env,
          input.origin      ?? '',
          input.destination ?? '',
          input.date,
          input.time_preference,
        );

        // If Darwin returned a hard error with no services, surface a user-friendly message
        if (rttResult.error && rttResult.services.length === 0 && rttResult.error !== 'advance_schedule') {
          toolResultContent = 'ERROR:DARWIN_UNAVAILABLE';
        } else {
          toolResultContent = formatTrainsForClaude(rttResult);
        }

        const dataSource = !rttResult.error ? 'darwin_live'
          : rttResult.error === 'advance_schedule' ? 'national_rail_scheduled'
          : 'estimated';

        broLog('darwin_result', {
          traceId,
          origin:       input.origin,
          destination:  input.destination,
          servicesFound: rttResult.services.length,
          dataSource,
          error:        rttResult.error ?? null,
          destinationCRS: rttResult.destinationCRS ?? null,
        });

        if (rttResult.services.length > 0) {
          const svc = rttResult.services[0];
          const ukTravelDate = rttResult.date.replace(/\//g, '-');
          trainDetails = {
            departureTime:      svc.departureTime,
            arrivalTime:        svc.arrivalTime,
            platform:           svc.platform,
            operator:           svc.operator,
            serviceUid:         svc.serviceUid,
            origin:             rttResult.origin,
            destination:        rttResult.destination,
            estimatedFareGbp:   svc.estimatedFareGbp,
            country:            'uk',
            destinationCRS:     rttResult.destinationCRS,
            travelDate:         ukTravelDate,
            departureDatetime:  `${ukTravelDate}T${svc.departureTime}:00`,
            dataSource,
            transportMode:      'rail',
          };

          // ── TfL final-leg routing ──────────────────────────────────────────
          // If arriving at a London terminus and user gave a final London destination,
          // query TfL Journey Planner for the city transfer leg.
          const finalDest = input.final_destination as string | undefined;
          const isLondonArrival = LONDON_TERMINI.has(rttResult.destinationCRS ?? '');
          broLog('tfl_decision', {
            traceId,
            destinationCRS: rttResult.destinationCRS ?? null,
            isLondonArrival,
            hasFinalDest: !!finalDest,
            finalDest: finalDest ?? null,
          });
          if (finalDest && isLondonArrival) {
            const tflLeg = await queryTfLFinalLeg(
              rttResult.destinationCRS,
              finalDest,
              (c.env as any).TFL_APP_KEY,
            ).catch(() => undefined);
            broLog('tfl_result', {
              traceId,
              success: !!tflLeg && !tflLeg?.error,
              summary: tflLeg?.summary ?? null,
              duration: tflLeg?.duration ?? null,
              error: tflLeg?.error ?? null,
            });
            if (tflLeg && !tflLeg.error) {
              trainDetails.finalLegSummary  = tflLeg.summary;
              trainDetails.finalLegDuration = tflLeg.duration;
              // Append to Claude's context so the narration naturally includes the final leg
              toolResultContent += `\nCity transfer from ${rttResult.destination}: ${tflLeg.summary}.`;
            }
          }
        }
        } // end else (UK Darwin branch)
      } else if (toolCall.name === 'book_train_india') {
        // ── Indian Railways query (IRCTC / RapidAPI) ─────────────────────
        const irResult = await queryIndianRail(
          c.env,
          input.origin      ?? '',
          input.destination ?? '',
          input.date,
          input.class_pref,
          input.time_preference,
        );

        toolResultContent = formatTrainsForClaudeIndia(irResult);

        const irDataSource = !irResult.error ? 'irctc_live' : 'estimated';
        broLog('irctc_result', {
          traceId,
          origin:        input.origin,
          destination:   input.destination,
          servicesFound: irResult.services.length,
          dataSource:    irDataSource,
          error:         irResult.error ?? null,
        });

        if (irResult.services.length > 0) {
          const svc = irResult.services[0];
          // Convert INR to USDC for the AgentPay payment layer (≈85 INR per USD)
          const INR_TO_USD = 0.012;
          // Parse travel date from input (may be ISO, "today", "tomorrow", etc.)
          const { parseRttDate } = await import('../lib/rtt');
          const irTravelDate = parseRttDate(input.date).replace(/\//g, '-');

          trainDetails = {
            departureTime:      svc.departureTime,
            arrivalTime:        svc.arrivalTime,
            platform:           undefined, // platform not known in advance for Indian rail
            operator:           `${svc.trainNumber} ${svc.trainName}`,
            serviceUid:         svc.trainNumber,
            origin:             irResult.origin,
            destination:        irResult.destination,
            estimatedFareGbp:   Math.round(svc.estimatedFareInr * INR_TO_USD * 100) / 100,
            trainNumber:        svc.trainNumber,
            trainName:          svc.trainName,
            classCode:          svc.classCode,
            fareInr:            svc.estimatedFareInr,
            country:            'india',
            travelDate:         irTravelDate,
            departureDatetime:  `${irTravelDate}T${svc.departureTime}:00`,
            dataSource:         irDataSource,
            transportMode:      'rail',
          };
        }
      } else if (toolCall.name === 'book_bus') {
        const busSupported = isSupportedBusRoute(input.origin ?? '', input.destination ?? '');
        const busResult = await queryBus(
          c.env,
          input.origin ?? '',
          input.destination ?? '',
          input.date as string | undefined,
          input.time_preference as string | undefined,
        );

        toolResultContent = busSupported
          ? formatGlobalGroundForClaude('bus', busResult)
          : `No bus corridor configured yet from ${input.origin ?? ''} to ${input.destination ?? ''}.`;
        if (!busSupported || busResult.services.length === 0) {
          (toolCall as any)._skipPlan = true;
        }

        const busDataSource = busResult.error === 'advance_schedule' ? 'bus_scheduled' : 'bus_live';
        broLog('bus_result', {
          traceId,
          origin: input.origin,
          destination: input.destination,
          servicesFound: busResult.services.length,
          dataSource: busDataSource,
          supported: busSupported,
        });

        if (busSupported && busResult.services.length > 0) {
          const svc = busResult.services[0];
          const travelDate = busResult.date.replace(/\//g, '-');
          trainDetails = {
            departureTime: svc.departureTime,
            arrivalTime: svc.arrivalTime,
            platform: svc.platform,
            operator: svc.operator,
            serviceUid: svc.serviceUid,
            origin: busResult.origin,
            destination: busResult.destination,
            estimatedFareGbp: svc.estimatedFareGbp,
            country: 'global',
            travelDate,
            departureDatetime: `${travelDate}T${svc.departureTime}:00`,
            dataSource: busDataSource,
            transportMode: 'bus',
          };
        }
      } else if (toolCall.name === 'plan_metro') {
        // ── India metro journey planner (Bengaluru + Pune) ────────────────
        const metroResult = planMetro(input.origin ?? '', input.destination ?? '');
        toolResultContent = formatMetroForClaude(metroResult);
        broLog('metro_result', {
          traceId,
          origin:       input.origin,
          destination:  input.destination,
          city:         metroResult.city,
          found:        metroResult.found,
          totalMinutes: metroResult.totalMinutes ?? null,
          fare:         metroResult.fare ?? null,
          stops:        metroResult.stops ?? null,
          legs:         metroResult.legs?.length ?? 0,
          error:        metroResult.error ?? null,
        });

      } else if (toolCall.name === 'search_flights') {
        // ── Duffel flight search (Phase 1 only) ───────────────────────────
        // Phase 2 booking happens in the hire section below (item.flightDetails).
        const originStr      = (input.origin      as string | undefined) ?? '';
        const destinationStr = (input.destination as string | undefined) ?? '';
        const dateStr        = (input.date        as string | undefined) ?? new Date().toISOString().slice(0, 10);
        const cabinClass     = (input.class_pref  as 'economy' | 'premium_economy' | 'business' | 'first' | undefined) ?? 'economy';
        const returnDate     = input.return_date  as string | undefined;
        const passengerCount = input.passengers   ? Number(input.passengers) : 1;

        {
          // ── Phase 1: search flights ──────────────────────────────────────
          const offers = c.env.DUFFEL_API_KEY
            ? await searchFlights(
                { origin: originStr, destination: destinationStr, departureDate: dateStr, returnDate, passengers: passengerCount, cabinClass },
                c.env.DUFFEL_API_KEY,
              ).catch(() => [])
            : [];

          toolResultContent = formatFlightsForClaude(offers, originStr, destinationStr, dateStr);

          // Stash best offerId + flightDetails for Phase 2 (passed through plan item)
          if (offers[0]) {
            (toolCall as any)._flightDetails = {
              origin:          offers[0].origin,
              destination:     offers[0].destination,
              departureAt:     offers[0].departureAt,
              arrivalAt:       offers[0].arrivalAt,
              carrier:         offers[0].carrier,
              flightNumber:    offers[0].flightNumber,
              totalAmount:     offers[0].totalAmount,
              currency:        offers[0].currency,
              stops:           offers[0].stops,
              durationMinutes: offers[0].durationMinutes,
              cabinClass:      offers[0].cabinClass,
              offerId:         offers[0].offerId,
              offerExpiresAt:  offers[0].offerExpiresAt,
              isReturn:        offers[0].isReturn,
            };
          }
          broLog('flights_result', {
            traceId,
            origin: originStr,
            destination: destinationStr,
            date: dateStr,
            found: offers.length,
          });
        }

      } else if (toolCall.name === 'discover_events') {
        // ── Ticketmaster event discovery ───────────────────────────────────
        const events = await searchEvents({
          city:       input.destination ?? '',
          travelDate: input.date        ?? new Date().toISOString().slice(0, 10),
          keyword:    input.genre as string | undefined,
          apiKey:     c.env.TICKETMASTER_API_KEY ?? '',
        }).catch(() => []);
        const eventDate = input.date as string ?? new Date().toISOString().slice(0, 10);
        toolResultContent = formatEventsForClaude(events, input.destination as string ?? '', eventDate);
        broLog('events_result', { traceId, destination: input.destination, found: events.length });

      } else if (toolCall.name === 'discover_nearby') {
        // ── Google Places nearby discovery ────────────────────────────────
        // Use GPS coords if provided, else geocode the location name, else Nominatim
        let coords: { lat: number; lon: number } | null = null;
        if (input.lat && input.lon) {
          coords = { lat: Number(input.lat), lon: Number(input.lon) };
        } else if (input.location || input.query) {
          const locationStr = (input.location ?? input.query ?? '') as string;
          coords = await geocodeAddress(locationStr, c.env.GOOGLE_MAPS_API_KEY ?? '').catch(() => null)
            ?? await geocodeCityNominatim(locationStr).catch(() => null);
        }

        let places: Awaited<ReturnType<typeof searchNearby>> = [];
        if (coords) {
          // Text search if query is descriptive, type search otherwise
          const query = input.query as string | undefined;
          places = query && query.length > 20
            ? await searchNearbyText(
                { query, lat: coords.lat, lon: coords.lon, maxResults: 5 },
                c.env.GOOGLE_MAPS_API_KEY ?? ''
              ).catch(() => [])
            : await searchNearby(
                {
                  lat: coords.lat,
                  lon: coords.lon,
                  type: (input.type as string | undefined) ?? 'restaurant',
                  maxResults: 5,
                  radiusMeters: input.radius_meters ? Number(input.radius_meters) : 1500,
                },
                c.env.GOOGLE_MAPS_API_KEY ?? ''
              ).catch(() => []);
        }
        toolResultContent = formatPlacesForClaude(places, (input.type as string | undefined) ?? 'place');
        (toolCall as any)._nearbyPlaces = places;
        broLog('nearby_result', {
          traceId,
          coordsSource: input.lat ? 'gps' : 'geocoded',
          found:        places.length,
          query:        input.query ?? input.location,
        });

      } else if (toolCall.name === 'navigate') {
        // ── Google Routes walking navigation ──────────────────────────────
        const destStr = (input.destination as string | undefined) ?? '';
        const destCoords = await geocodeAddress(destStr, c.env.GOOGLE_MAPS_API_KEY ?? '').catch(() => null)
          ?? await geocodeCityNominatim(destStr).catch(() => null);
        const originCoords = (input.origin_lat && input.origin_lon)
          ? { lat: Number(input.origin_lat), lon: Number(input.origin_lon) }
          : null;

        if (originCoords && destCoords && c.env.GOOGLE_MAPS_API_KEY) {
          const route = await computeRoute({
            originLat:  originCoords.lat,
            originLon:  originCoords.lon,
            destLat:    destCoords.lat,
            destLon:    destCoords.lon,
            travelMode: (input.travel_mode as 'WALK' | 'BICYCLE' | 'TRANSIT' | 'DRIVE' | undefined) ?? 'WALK',
          }, c.env.GOOGLE_MAPS_API_KEY).catch(() => null);

          if (route) {
            toolResultContent = `Route to ${destStr}: ${formatRouteForClaude(route)}`;
            // Stash route data for Meridian map screen
            const planExtra = { routeData: route };
            broLog('navigate_result', {
              traceId,
              destination:     destStr,
              durationMins:    Math.round(route.durationSeconds / 60),
              distanceMeters:  route.distanceMeters,
              steps:           route.steps.length,
            });
            // Attach routeData to the current plan item after push (done below)
            // We store it temporarily — planItems.push happens after this block
            (toolCall as any)._routeData = planExtra.routeData;
          } else {
            toolResultContent = `Route to ${destStr}: unavailable (try a more specific destination).`;
          }
        } else if (!c.env.GOOGLE_MAPS_API_KEY) {
          toolResultContent = `Navigation requires GOOGLE_MAPS_API_KEY to be configured.`;
        } else {
          toolResultContent = `I need your current location to navigate. Enable GPS in the app.`;
        }

      } else if (toolCall.name === 'book_restaurant') {
        // ── Restaurant discovery (Google Places + OpenTable stub) ─────────
        // Try OpenTable first (returns [] if key not set), then fall back to Places
        const restaurantResults = await searchRestaurants({
          city:         (input.location as string | undefined) ?? '',
          date:         (input.date     as string | undefined) ?? '',
          time:         input.time      as string | undefined,
          partySize:    input.party_size ? Number(input.party_size) : 2,
          cuisineType:  input.cuisine   as string | undefined,
          apiKey:       c.env.OPENTABLE_API_KEY,
        }).catch(() => []);

        const city = (input.location as string | undefined) ?? '';
        if (restaurantResults.length > 0) {
          toolResultContent = formatRestaurantsForClaude(restaurantResults, city);
        } else {
          // Fallback: Google Places text search for restaurants
          const query = input.cuisine
            ? `${input.cuisine} restaurant in ${city}`
            : `restaurant in ${city}`;
          const locationCoords = await geocodeAddress(city, c.env.GOOGLE_MAPS_API_KEY ?? '').catch(() => null)
            ?? await geocodeCityNominatim(city).catch(() => null);
          const places = locationCoords
            ? await searchNearbyText(
                { query, lat: locationCoords.lat, lon: locationCoords.lon, maxResults: 5 },
                c.env.GOOGLE_MAPS_API_KEY ?? ''
              ).catch(() => [])
            : [];
          toolResultContent = formatPlacesForClaude(places, 'restaurant');
          (toolCall as any)._nearbyPlaces = places;
        }
        broLog('restaurant_result', {
          traceId,
          location:  input.location,
          found:     restaurantResults.length,
        });

      } else if (toolCall.name === 'book_hotel') {
        // ── Hotel search via Xotelo free-tier price aggregation ───────────
        const city     = (input.location as string | undefined) ?? (input.city as string | undefined) ?? (input.destination as string | undefined) ?? '';
        const checkIn  = (input.check_in  as string | undefined) ?? '';
        const checkOut = (input.check_out as string | undefined) ?? '';
        const rooms    = input.rooms  ? Number(input.rooms)  : 1;
        const stars    = input.stars  ? Number(input.stars)  : undefined;

        const hotelResults = await searchHotels({ city, checkIn, checkOut, rooms, stars }).catch(() => []);

        if (hotelResults.length > 0) {
          toolResultContent = formatHotelsForClaude(hotelResults, city, checkIn, checkOut);
          (toolCall as any)._hotelDetails = {
            city,
            checkIn,
            checkOut,
            bestOption:  hotelResults[0],
            allOptions:  hotelResults,
          };
        } else {
          toolResultContent = `No hotels found in ${city} for those dates. Try a different city or dates.`;
        }

        broLog('hotel_result', {
          traceId,
          city,
          checkIn,
          checkOut,
          found: hotelResults.length,
          live:  hotelResults.filter(h => h.isLive).length,
        });

      } else if (toolCall.name === 'research') {
        // ── Real-time travel intel via Perplexity Sonar ───────────────────
        const query    = (input.query    as string | undefined) ?? '';
        const location = (input.location as string | undefined) ?? '';
        const sonarQ   = location ? `${query} (location: ${location})` : query;
        if (c.env.PERPLEXITY_API_KEY) {
          const sonarResult = await askSonar(sonarQ, c.env.PERPLEXITY_API_KEY, { maxTokens: 256 }).catch(() => null);
          toolResultContent = formatSonarForClaude(sonarResult, sonarQ);
          broLog('sonar_result', { traceId, query: sonarQ, found: !!sonarResult });
        } else {
          toolResultContent = `No live intel available for: ${sonarQ}`;
          broLog('sonar_skipped', { traceId, query: sonarQ, reason: 'no_key' });
        }
        (toolCall as any)._skipPlan = true;  // research is info-only — no hire needed

      } else {
        // Non-train skills: tell Claude the agent is available
        broLog('bro_signal', { traceId, type: 'tool_fallthrough', skill: toolCall.name, hirerId });
        const agentName = agent?.name ?? skill.displayName;
        const priceStr  = agent?.pricePerTaskUsd ? `$${agent.pricePerTaskUsd.toFixed(2)} USDC` : 'standard rate';
        toolResultContent = `${skill.displayName} is available via ${agentName} at ${priceStr}. Ready to book.`;
      }

      // Darwin hard failure — return user-friendly error immediately
      if (toolResultContent === 'ERROR:DARWIN_UNAVAILABLE') {
        broLog('bro_signal', { traceId, type: 'tool_failure', skill: 'search_trains_uk', reason: 'darwin_unavailable', hirerId });
        broLog('darwin_unavailable', { traceId, origin: input.origin, destination: input.destination });
        return c.json({
          narration: "Having trouble with live times right now. Please try again in a moment.",
          actions:   [],
          needsBiometric: false,
        });
      }

      toolResultsForClaude.push({
        type:        'tool_result',
        tool_use_id: toolCall.id,
        content:     toolResultContent,
      });

      if ((toolCall as any)._skipPlan) {
        continue;
      }

      // Estimated price: real fare from train details, or flight amount, or route estimate, or agent price
      let estimatedPriceUsdc = agent?.pricePerTaskUsd ?? 1;
      if (trainDetails?.estimatedFareGbp) {
        estimatedPriceUsdc = trainDetails.estimatedFareGbp;
      } else if ((toolCall as any)._flightDetails?.totalAmount) {
        // Convert flight price to GBP-equivalent for the hire layer.
        // Duffel returns amounts in the offer's native currency (GBP/EUR/USD).
        // Approximate conversion: EUR→GBP ×0.85, USD→GBP ×0.80, others pass through.
        const flightCurrency = ((toolCall as any)._flightDetails.currency as string ?? 'GBP').toUpperCase();
        const rawAmount      = Number((toolCall as any)._flightDetails.totalAmount);
        const toGbp: Record<string, number> = { GBP: 1, EUR: 0.85, USD: 0.80, CAD: 0.58, AUD: 0.51 };
        estimatedPriceUsdc = Math.round(rawAmount * (toGbp[flightCurrency] ?? 0.80) * 100) / 100;
      } else if (toolCall.name === 'book_train') {
        // No live trains but we can still estimate the fare from route tables
        const { stationToCRS, estimateFareGbp } = await import('../lib/rtt');
        const oCRS = stationToCRS(input.origin ?? '');
        const dCRS = stationToCRS(input.destination ?? '');
        if (oCRS && dCRS) estimatedPriceUsdc = estimateFareGbp(oCRS, dCRS);
      }

      const tripContext = buildPlanTripContext({
        toolName: skill.toolName,
        input: toolCall.input as Record<string, unknown>,
        trainDetails,
        routeData: (toolCall as any)._routeData ?? undefined,
        nearbyPlaces: (toolCall as any)._nearbyPlaces ?? undefined,
        flightOffer: (toolCall as any)._flightDetails
          ? {
              offerId: (toolCall as any)._flightDetails.offerId,
              offerExpiresAt: (toolCall as any)._flightDetails.offerExpiresAt,
              totalAmount: (toolCall as any)._flightDetails.totalAmount,
              currency: (toolCall as any)._flightDetails.currency,
              carrier: (toolCall as any)._flightDetails.carrier,
              flightNumber: (toolCall as any)._flightDetails.flightNumber,
              origin: (toolCall as any)._flightDetails.origin,
              destination: (toolCall as any)._flightDetails.destination,
              departureAt: (toolCall as any)._flightDetails.departureAt,
              arrivalAt: (toolCall as any)._flightDetails.arrivalAt,
              durationMinutes: (toolCall as any)._flightDetails.durationMinutes,
              stops: (toolCall as any)._flightDetails.stops,
              cabinClass: (toolCall as any)._flightDetails.cabinClass,
              label: '',
              isReturn: (toolCall as any)._flightDetails.isReturn,
            }
          : undefined,
      });

      planItems.push({
        toolName:           skill.toolName,
        toolUseId:          toolCall.id,
        agentId:            agent?.agentId ?? `agt_system_${skill.category}_01`,
        agentName:          agent?.name    ?? skill.displayName,
        displayName:        skill.displayName,
        estimatedPriceUsdc,
        input:              toolCall.input as Record<string, unknown>,
        trainDetails,
        dataSource:         trainDetails?.dataSource,
        finalLegSummary:    trainDetails?.finalLegSummary,
        routeData:          (toolCall as any)._routeData     ?? undefined,
        nearbyPlaces:       (toolCall as any)._nearbyPlaces  ?? undefined,
        flightDetails:      (toolCall as any)._flightDetails ?? undefined,
        hotelDetails:       (toolCall as any)._hotelDetails  ?? undefined,
        tripContext,
      });
    }
  } finally {
    await sql.end();
  }

  if (planItems.length === 0) {
    broLog('plan_empty', { traceId });
    return c.json({
      narration: "I couldn't find an available specialist for that right now.",
      actions:   [],
      needsBiometric: false,
    });
  }

  // Info-only tools return content with no payment or biometric required
  const INFO_ONLY_TOOLS = new Set(['plan_metro', 'discover_events', 'discover_nearby', 'navigate', 'book_restaurant', 'research']);
  const isInfoOnly = planItems.every(p => INFO_ONLY_TOOLS.has(p.toolName));

  broLog('plan_built', {
    traceId,
    itemCount:   planItems.length,
    tools:       planItems.map(p => p.toolName),
    totalUsdc:   planItems.reduce((s, p) => s + p.estimatedPriceUsdc, 0),
    dataSources: planItems.map(p => p.dataSource ?? null),
    hasTfLLeg:   planItems.some(p => !!p.finalLegSummary),
  });

  // ── Second Claude call with real data → natural narration ─────────────────

  let narration = buildFallbackNarration(planItems);
  try {
    const narrationCall = await callClaude(anthropicKey, {
      system: systemPrompt,
      messages: [
        { role: 'user',      content: transcript },
        { role: 'assistant', content: toolUseBlocks.map(b => ({ type: 'tool_use' as const, id: b.id, name: b.name, input: b.input })) },
        { role: 'user',      content: toolResultsForClaude },
      ],
      max_tokens: 256,
    });
    if (narrationCall.ok) {
      const narrationData = await narrationCall.json() as AnthropicResponse;
      const text = extractText(narrationData);
      if (text) narration = text;
    }
  } catch {
    // Narration timeout — use fallback, still return the plan
  }

  const totalUsdc = planItems.reduce((s, p) => s + p.estimatedPriceUsdc, 0);
  const totalFiat = planItems.reduce((s, p) => s + planItemFiatAmount(p, currency.code), 0);

  // Assign a shared journeyId when multiple legs are booked together
  const journeyId = planItems.length > 1
    ? `jrn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    : undefined;
  if (journeyId) {
    for (const item of planItems) {
      (item as any).journeyId = journeyId;
    }
  }

  const primaryTripContext = planItems[0]?.tripContext;

  if (isInfoOnly) {
    return c.json({
      narration,
      actions: [],
      needsBiometric: false,
      tripContext: primaryTripContext,
      proactiveCards: primaryTripContext?.proactiveCards ?? [],
      usualRoute,
    });
  }

  return c.json({
    narration,
    needsBiometric: true,
    plan:           planItems,
    actions:        [],
    estimatedPriceUsdc: totalUsdc,
    fiatAmount:    Math.round(totalFiat * 100) / 100,
    currencySymbol: currency.symbol,
    currencyCode:   currency.code,
    journeyId,
    tripContext:    primaryTripContext,
    proactiveCards: primaryTripContext?.proactiveCards ?? [],
    usualRoute,
  });
});

// ── POST /api/concierge/fulfill/:jobId ────────────────────────────────────────
// Called by Make.com (or admin) once the real ticket has been purchased.
// Sends the confirmed ticket email, marks the job complete, updates the ops sheet.

conciergeRouter.post('/fulfill/:jobId', async (c) => {
  const adminSecret = c.env.ADMIN_SECRET_KEY;
  if (!adminSecret) {
    return c.json({ error: 'Fulfill endpoint not configured (missing ADMIN_SECRET_KEY)' }, 503);
  }

  const jobId = c.req.param('jobId');
  let body: {
    adminSecret:   string;
    realTicketRef: string;
    userEmail?:    string;
    userName?:     string;
    userPhone?:    string;
    actualFare?:   number;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (body.adminSecret !== adminSecret) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  if (!body.realTicketRef) {
    return c.json({ error: 'realTicketRef required' }, 400);
  }

  // Load stored ops data from job metadata
  const sql = createDb(c.env);
  let broRef       = '';
  let hirerId      = '';
  let trainDetails: TrainDetails | undefined;
  let userEmail    = body.userEmail ?? '';
  let userName     = body.userName;
  let userPhone    = body.userPhone ?? '';
  let currentTripContext: TripContext | undefined;

  try {
    const rows = await sql`
      SELECT metadata FROM payment_intents WHERE id = ${jobId} LIMIT 1
    `;
    if (rows.length === 0) return c.json({ error: 'Job not found' }, 404);
    const meta = rows[0].metadata as Record<string, unknown>;
    broRef       = (meta.broRef      as string) ?? '';
    hirerId      = (meta.hirerId     as string) ?? '';
    trainDetails = (meta.trainDetails as TrainDetails | undefined);
    currentTripContext = (meta.tripContext as TripContext | undefined) ?? undefined;
    if (!userEmail) userEmail = (meta.userEmail as string) ?? '';
    if (!userName)  userName  = (meta.userName  as string) ?? undefined;
    if (!userPhone) userPhone = (meta.userPhone  as string) ?? '';
  } finally {
    await sql.end();
  }

  if (!userEmail) return c.json({ error: 'userEmail not found — pass in request body' }, 400);

  const isIndia = trainDetails?.country === 'india';
  const proof: BookingProof = {
    bookingRef:    body.realTicketRef,
    departureTime: trainDetails?.departureTime ?? '',
    arrivalTime:   trainDetails?.arrivalTime,
    platform:      trainDetails?.platform,
    operator:      trainDetails?.operator      ?? '',
    fromStation:   trainDetails?.origin        ?? '',
    toStation:     trainDetails?.destination   ?? '',
    serviceUid:    trainDetails?.serviceUid    ?? '',
    fareGbp:       body.actualFare ?? trainDetails?.estimatedFareGbp ?? 0,
    country:       trainDetails?.country,
    fareInr:       body.actualFare ?? trainDetails?.fareInr,
    trainNumber:   trainDetails?.trainNumber,
    trainName:     trainDetails?.trainName,
    classCode:     trainDetails?.classCode,
    bookedAt:      new Date().toISOString(),
    note:          'Manually fulfilled.',
  };

  const completedTripContext = toCompletedTripContext(currentTripContext, {
    bookingRef:       body.realTicketRef,
    departureTime:    trainDetails?.departureDatetime ?? trainDetails?.departureTime,
    arrivalTime:      trainDetails?.arrivalTime,
    operator:         trainDetails?.operator,
    origin:           trainDetails?.origin,
    destination:      trainDetails?.destination,
    finalLegSummary:  trainDetails?.finalLegSummary,
  });
  if (completedTripContext) {
    const sql2 = createDb(c.env);
    try {
      await sql2`
        UPDATE payment_intents
        SET metadata = metadata || ${JSON.stringify({ tripContext: completedTripContext })}::jsonb
        WHERE id = ${jobId}
      `;
    } finally {
      await sql2.end().catch(() => {});
    }
  }

  // Sheet update (COMPLETE status + real ticket ref) is handled by Make.com Scenario 2
  // after it receives a 200 from this endpoint — no webhook needed here.
  await Promise.all([
    sendTicketConfirmedEmail(c.env.RESEND_API_KEY, {
      to:            userEmail,
      name:          userName,
      broRef,
      realTicketRef: body.realTicketRef,
      proof,
    }),
    autoCompleteJob(c.env.API_BASE_URL, jobId, hirerId, proof),
  ]);

  return c.json({ ok: true, jobId, broRef, realTicketRef: body.realTicketRef });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function callClaude(apiKey: string, body: Record<string, unknown>) {
  // Wrap system string in cache_control block — 90% savings on cache hits.
  // The system prompt is large (~2k tokens) and identical across all Bro calls
  // for the same user session. Caching pays back after the first request.
  const bodyWithCache = { ...body };
  if (typeof bodyWithCache.system === 'string') {
    bodyWithCache.system = [
      { type: 'text', text: bodyWithCache.system, cache_control: { type: 'ephemeral' } },
    ];
  }
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta':    'prompt-caching-2024-07-31',
      'content-type':      'application/json',
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', ...bodyWithCache }),
    // 25s — Workers have a 30s CPU wall; leave headroom for DB + RTT
    signal: AbortSignal.timeout(25_000),
  });
}

async function findBestAgent(
  sql: ReturnType<typeof createDb>,
  category: string,
): Promise<{ agentId: string; name: string; pricePerTaskUsd: number; grade: string } | null> {
  try {
    // Enforce grade B or above (system prompt rule 7). Grade is derived from AgentRank score:
    //   A = 800+, B = 600+, C = 400+, D = 200+, F = <200
    // Programmatic/self-registered agents (pilot set) are trusted unconditionally — they are
    // all first-party and have no external bad actors to filter.
    const rows = await sql`
      SELECT
        ai.agent_id              AS "agentId",
        ai.metadata->>'name'     AS "name",
        COALESCE((ai.metadata->>'pricePerTaskUsd')::numeric, 1)::float AS "pricePerTaskUsd",
        CASE
          WHEN COALESCE(ar.score, 0) >= 800 THEN 'A'
          WHEN COALESCE(ar.score, 0) >= 600 THEN 'B'
          WHEN COALESCE(ar.score, 0) >= 400 THEN 'C'
          WHEN COALESCE(ar.score, 0) >= 200 THEN 'D'
          ELSE 'F'
        END AS "grade"
      FROM agent_identities ai
      LEFT JOIN agentrank_scores ar ON ar.agent_id = ai.agent_id
      WHERE ai.metadata->>'category' = ${category}
        AND (ai.kyc_status = 'programmatic' OR ai.verified = true)
        AND (
          ai.kyc_status = 'programmatic'
          OR COALESCE(ar.score, 0) >= 600
        )
      ORDER BY COALESCE(ar.score, 0) DESC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rows[0] as { agentId: string; name: string; pricePerTaskUsd: number; grade: string };
  } catch {
    return null;
  }
}

async function hireAgent(
  apiBase: string,
  hirerId: string,
  agentId: string,
  jobDescription: string,
  agreedPriceUsdc: number,
): Promise<{ jobId: string; agreedPriceUsdc: number; completionSecret?: string }> {
  const res = await fetch(`${apiBase}/api/marketplace/hire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hirerId, agentId, jobDescription, agreedPriceUsdc }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Hire failed (${res.status}): ${err.slice(0, 100)}`);
  }
  return res.json() as Promise<{ jobId: string; agreedPriceUsdc: number; completionSecret?: string }>;
}

async function autoCompleteJob(
  apiBase: string,
  jobId: string,
  completionSecret: string,
  completionProof: BookingProof,
): Promise<void> {
  try {
    await fetch(`${apiBase}/api/marketplace/hire/${jobId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completionSecret, completionProof }),
    });
  } catch {
    // Best-effort — the job stays escrow_pending if this fails
  }
}

/** Generate a UK-style booking reference (e.g. BRO-K7X2NP) */
function generateBookingRef(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = 'BRO-';
  for (let i = 0; i < 6; i++) {
    ref += chars[Math.floor(Math.random() * chars.length)];
  }
  return ref;
}

/** Generate a 10-digit Indian PNR (IRCTC format) */
function generateIndianPNR(): string {
  // PNR starts with 2-digit zone code (21=NR, 24=WR, 22=SR etc.) + 8 random digits
  const zones = ['21', '22', '24', '25', '26', '27'];
  const zone  = zones[Math.floor(Math.random() * zones.length)];
  let pnr = zone;
  for (let i = 0; i < 8; i++) pnr += Math.floor(Math.random() * 10);
  return pnr;
}

function buildFallbackNarration(planItems: PlanItem[]): string {
  if (planItems.length === 1) {
    const p = planItems[0];
    if (p.trainDetails) {
      if (p.trainDetails.transportMode === 'bus') {
        return `${p.trainDetails.operator} at ${p.trainDetails.departureTime}, ${p.trainDetails.origin} to ${p.trainDetails.destination} — ${estimatedFareLabelFromDetails(p.trainDetails)}. Fingerprint to confirm.`;
      }
      if (p.trainDetails.country === 'india') {
        return `${p.trainDetails.trainName} at ${p.trainDetails.departureTime}, ${p.trainDetails.origin} to ${p.trainDetails.destination} — estimated ₹${p.trainDetails.fareInr}. Fingerprint to confirm.`;
      }
      return `${p.trainDetails.operator} at ${p.trainDetails.departureTime}, ${p.trainDetails.origin} to ${p.trainDetails.destination} — ${estimatedFareLabelFromDetails(p.trainDetails)}. Fingerprint to confirm.`;
    }
    return `I can ${p.displayName.toLowerCase()} for approximately $${p.estimatedPriceUsdc.toFixed(2)}. Fingerprint to confirm.`;
  }
  const total = planItems.reduce((s, p) => s + p.estimatedPriceUsdc, 0);
  return `I can arrange ${planItems.map(p => p.displayName).join(' + ')} — approximately $${total.toFixed(2)} total. Fingerprint to confirm.`;
}

function scopeProfileFields(
  profile: Record<string, unknown>,
  allowedFields: string[],
): Record<string, unknown> {
  if (allowedFields.length === 0) return {};
  return Object.fromEntries(
    allowedFields
      .filter(f => profile[f] !== undefined && profile[f] !== null && profile[f] !== '')
      .map(f => [f, profile[f]]),
  );
}

function buildJobDescription(
  toolName: string,
  input: Record<string, string | unknown>,
  scopedProfile?: Record<string, unknown>,
): string {
  const lines = [
    `Task: ${toolName}`,
    ...Object.entries(input).map(([k, v]) => `${k}: ${v}`),
  ];

  if (scopedProfile && Object.keys(scopedProfile).length > 0) {
    lines.push('');
    lines.push('TRAVELER PROFILE (shared for this booking only, minimum necessary fields):');
    const labels: Record<string, string> = {
      legalName:      'Name',
      email:          'Email',
      phone:          'Phone',
      dateOfBirth:    'Date of birth',
      nationality:    'Nationality',
      documentType:   'Document type',
      documentNumber: 'Document number',
      documentExpiry: 'Document expiry',
      seatPreference:  'Seat preference',
      classPreference: 'Class preference',
      railcardType:    'UK Railcard',
      indiaClassTier:  'India class tier',
      irctcId:         'IRCTC ID',
      irctcUsername:   'IRCTC username',
    };
    for (const [k, v] of Object.entries(scopedProfile)) {
      lines.push(`${labels[k] ?? k}: ${v}`);
    }
  }

  return lines.join('\n');
}

function transportNoun(details: { transportMode?: 'rail' | 'bus'; country?: string }): string {
  if (details.transportMode === 'bus') return 'coach';
  if (details.country === 'india') return 'ticket';
  return 'ticket';
}

function estimatedFareLabelFromDetails(details: {
  country?: string;
  transportMode?: 'rail' | 'bus';
  estimatedFareGbp?: number;
  fareInr?: number;
}): string {
  if (details.country === 'india' && details.fareInr != null) {
    return `₹${details.fareInr} estimated`;
  }
  if (details.transportMode === 'bus') {
    return `about £${details.estimatedFareGbp ?? 0} equivalent`;
  }
  if (details.country === 'eu') {
    return `about €${details.estimatedFareGbp ?? 0}`;
  }
  if (details.country === 'global') {
    return `about £${details.estimatedFareGbp ?? 0} equivalent`;
  }
  return `£${details.estimatedFareGbp ?? 0} estimated`;
}

function estimatedFareLabelFromProof(proof: {
  country?: string;
  transportMode?: 'rail' | 'bus';
  fareGbp?: number;
  fareInr?: number;
}): string {
  if (proof.country === 'india' && proof.fareInr != null) {
    return `₹${proof.fareInr}`;
  }
  if (proof.transportMode === 'bus' || proof.country === 'global') {
    return `about £${proof.fareGbp ?? 0} equivalent`;
  }
  if (proof.country === 'eu') {
    return `about €${proof.fareGbp ?? 0}`;
  }
  return `£${proof.fareGbp ?? 0}`;
}

// ── Email 1: sent immediately after biometric confirm ─────────────────────────

async function sendBookingRequestEmail(
  resendKey: string | undefined,
  params: {
    to:           string | undefined;
    name:         string | undefined;
    broRef:       string;
    trainDetails: TrainDetails;
  },
): Promise<void> {
  if (!resendKey) return;

  const { to, name, broRef, trainDetails } = params;
  const greeting    = name ? `Hi ${name.split(' ')[0]},` : 'Hi,';
  const isIndia     = trainDetails.country === 'india';
  const isBus       = trainDetails.transportMode === 'bus';
  const fareDisplay = estimatedFareLabelFromDetails(trainDetails);
  const arrivalLine = trainDetails.arrivalTime ? ` → arrives ${trainDetails.arrivalTime}` : '';

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
      <h2 style="color:#2563eb">Request Received</h2>
      <p>${greeting}</p>
      <p>We're securing your ${transportNoun(trainDetails)} now. Your real reference will arrive in a separate email within 15 minutes.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr><td style="padding:8px 0;color:#666;width:140px">BRO Ref</td>
            <td style="padding:8px 0;font-weight:700;font-family:monospace;letter-spacing:2px;color:#2563eb">${broRef}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Route</td>
            <td style="padding:8px 0">${trainDetails.origin} → ${trainDetails.destination}</td></tr>
        <tr><td style="padding:8px 0;color:#666">${isBus ? 'Requested coach' : 'Requested service'}</td>
            <td style="padding:8px 0">${trainDetails.departureTime}${arrivalLine} · ${trainDetails.operator}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Est. fare</td>
            <td style="padding:8px 0">${fareDisplay}</td></tr>
      </table>
      <p style="background:#eff6ff;border-left:3px solid #2563eb;padding:12px;font-size:13px;color:#1e40af">
        Keep your BRO reference <strong>${broRef}</strong>. Your actual ${isBus ? 'coach' : 'ticket'} reference will follow once secured.
      </p>
      <p style="color:#666;font-size:13px">Bro · AgentPay</p>
    </div>
  `;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    'Bro <bookings@agentpay.gg>',
        to:      [to],
        subject: isIndia
          ? `Your request is in — BRO ref ${broRef}`
          : `Your request is in — ${broRef}`,
        html,
      }),
    });
  } catch {
    // Best-effort
  }
}

// ── Email 2: sent after manual fulfilment via /fulfill endpoint ────────────────

async function sendTicketConfirmedEmail(
  resendKey: string | undefined,
  params: {
    to:            string;
    name:          string | undefined;
    broRef:        string;
    realTicketRef: string;
    proof:         BookingProof;
  },
): Promise<void> {
  if (!resendKey || !params.to) return;

  const { to, name, broRef, realTicketRef, proof } = params;
  const greeting    = name ? `Hi ${name.split(' ')[0]},` : 'Hi,';
  const isIndia     = proof.country === 'india';
  const isBus       = proof.transportMode === 'bus';
  const arrivalLine = proof.arrivalTime ? ` → arrives ${proof.arrivalTime}` : '';
  const fareDisplay = estimatedFareLabelFromProof(proof);

  const html = isIndia ? `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
      <h2 style="color:#f97316">Ticket Confirmed ✓</h2>
      <p>${greeting}</p>
      <p>Your ticket is confirmed and ready. Here are your journey details:</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr><td style="padding:8px 0;color:#666;width:140px">PNR Number</td>
            <td style="padding:8px 0;font-weight:700;font-family:monospace;letter-spacing:2px;color:#f97316">${realTicketRef}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Train</td>
            <td style="padding:8px 0;font-weight:600">${proof.trainNumber ?? ''} ${proof.trainName ?? ''}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Route</td>
            <td style="padding:8px 0">${proof.fromStation} → ${proof.toStation}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Departure</td>
            <td style="padding:8px 0">${proof.departureTime}${arrivalLine}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Class</td>
            <td style="padding:8px 0">${proof.classCode ?? '3A'}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Fare</td>
            <td style="padding:8px 0">${fareDisplay}</td></tr>
        <tr><td style="padding:8px 0;color:#666">BRO ref</td>
            <td style="padding:8px 0;font-family:monospace;color:#999">${broRef}</td></tr>
      </table>
      <p style="background:#fff7ed;border-left:3px solid #f97316;padding:12px;font-size:13px;color:#92400e">
        Keep your PNR <strong>${realTicketRef}</strong> safe. You'll need it at the station.
      </p>
      <p style="color:#666;font-size:13px">Bro · AgentPay</p>
    </div>
  ` : `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
      <h2 style="color:#16a34a">${isBus ? 'Coach Confirmed ✓' : 'Ticket Confirmed ✓'}</h2>
      <p>${greeting}</p>
      <p>Your ${isBus ? 'coach seat' : 'ticket'} is confirmed and ready. Here are your journey details:</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr><td style="padding:8px 0;color:#666;width:140px">${isBus ? 'Coach Ref' : 'Ticket Ref'}</td>
            <td style="padding:8px 0;font-weight:700;font-family:monospace;letter-spacing:2px;color:#16a34a">${realTicketRef}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Route</td>
            <td style="padding:8px 0">${proof.fromStation} → ${proof.toStation}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Departs</td>
            <td style="padding:8px 0">${proof.departureTime}${arrivalLine}</td></tr>
        ${proof.platform ? `<tr><td style="padding:8px 0;color:#666">Platform</td><td style="padding:8px 0">${proof.platform}</td></tr>` : ''}
        <tr><td style="padding:8px 0;color:#666">Operator</td>
            <td style="padding:8px 0">${proof.operator}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Fare</td>
            <td style="padding:8px 0">${fareDisplay}</td></tr>
        <tr><td style="padding:8px 0;color:#666">BRO ref</td>
            <td style="padding:8px 0;font-family:monospace;color:#999">${broRef}</td></tr>
      </table>
      <p style="color:#666;font-size:13px">Bro · AgentPay</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#9ca3af">Booked by your Bro concierge via AgentPay.</p>
    </div>
  `;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'Bro <bookings@agentpay.gg>',
        to:      [to],
        subject: isIndia
          ? `Ticket confirmed — PNR ${realTicketRef}`
          : `Ticket confirmed — ${realTicketRef}`,
        html,
      }),
    });
  } catch {
    // Best-effort
  }
}

// ── Ops webhook (Make.com / Google Sheet) ─────────────────────────────────────

async function fireMakeWebhook(
  webhookUrl: string | undefined,
  payload: {
    broRef:        string;
    jobId:         string;
    status:        'PENDING' | 'COMPLETE' | 'FAILED';
    userEmail:     string;
    userName:      string;
    userWhatsapp:  string;
    route:         string;
    date:          string;
    time:          string;
    arrivalTime:   string;
    operator:      string;
    platform:      string;
    estimatedFare: string;
    currency:      string;
    country:       string;
    dataSource:    string;
    realTicketRef?: string;
    emailSent?:    boolean;
    bookedAt:      string;
  },
): Promise<void> {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
  } catch {
    // Best-effort
  }
}

// ── Admin alert email ─────────────────────────────────────────────────────────

async function sendAdminAlert(
  resendKey:   string | undefined,
  adminEmail:  string | undefined,
  params: {
    broRef:        string;
    jobId:         string;
    userEmail:     string;
    userName:      string;
    origin:        string;
    destination:   string;
    departureTime: string;
    estimatedFare: string;
    country:       string;
  },
): Promise<void> {
  if (!resendKey || !adminEmail) return;
  const isIndia = params.country === 'india';
  const isGlobal = params.country === 'global';
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'Bro Ops <ops@agentpay.gg>',
        to:      [adminEmail],
        subject: `🚂 NEW BOOKING — ${params.broRef} | ${params.origin} → ${params.destination} | ${params.estimatedFare}`,
        html: `
          <div style="font-family:monospace;max-width:520px;margin:0 auto;color:#111">
            <h2 style="color:#dc2626">New booking to fulfil</h2>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:6px 0;color:#666;width:120px">BRO Ref</td>
                  <td style="font-weight:700;color:#dc2626">${params.broRef}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Job ID</td>
                  <td>${params.jobId}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Customer</td>
                  <td>${params.userName} · ${params.userEmail}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Route</td>
                  <td>${params.origin} → ${params.destination}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Departure</td>
                  <td>${params.departureTime}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Est. fare</td>
                  <td>${params.estimatedFare}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Market</td>
                  <td>${isIndia ? '🇮🇳 India (IRCTC)' : isGlobal ? '🌍 Global ground transport' : '🇬🇧/🇪🇺 Rail partner'}</td></tr>
            </table>
            <p style="background:#fef2f2;border-left:3px solid #dc2626;padding:12px;margin-top:20px;font-size:13px">
              <strong>Action required:</strong> Book on ${isIndia ? 'IRCTC' : isGlobal ? 'the relevant ground transport partner' : 'the rail partner'} and enter the real reference in the ops sheet to trigger the confirmation email.
            </p>
          </div>
        `,
      }),
    });
  } catch {
    // Best-effort
  }
}

/**
 * Fire a structured booking event to the Make.com webhook.
 * Make.com creates a Google Sheet row (status=PENDING) for manual fulfilment.
 * OpenClaw monitors the sheet and books on Trainline/IRCTC/MakeMyTrip,
 * stopping for human payment confirmation before completing.
 *
 * Payload columns match the Google Sheet exactly:
 *   BRO_REF | STATUS | USER_EMAIL | USER_NAME | USER_PHONE |
 *   ORIGIN | DESTINATION | DATE | DEPARTURE_TIME | ARRIVAL_TIME |
 *   OPERATOR | TRAIN_NUMBER | CLASS_CODE | PLATFORM |
 *   ESTIMATED_FARE | CURRENCY | COUNTRY | DATA_SOURCE |
 *   REAL_TICKET_REF (empty — filled when fulfilled) |
 *   JOB_ID | BOOKED_AT
 */
async function fireOperationsWebhook(
  webhookUrl: string,
  params: {
    proof: BookingProof;
    userEmail?: string;
    userName?: string;
    userPhone?: string;
    userWhatsapp?: string;
    jobId: string;
  },
): Promise<void> {
  const { proof, userEmail, userName, userPhone, userWhatsapp, jobId } = params;
  const isIndia = proof.country === 'india';

  // Travel date (when the train actually runs) — NOT the booking creation date.
  // Falls back to bookedAt date only if travelDate was not threaded through.
  const travelDate = proof.travelDate ?? new Date(proof.bookedAt).toISOString().split('T')[0];

  const payload = {
    BRO_REF:          proof.bookingRef,
    STATUS:           'PENDING',
    USER_EMAIL:       userEmail     ?? '',
    USER_NAME:        userName      ?? '',
    USER_PHONE:       userPhone     ?? '',
    USER_WHATSAPP:    userWhatsapp  ?? '',
    ORIGIN:           proof.fromStation  ?? '',
    DESTINATION:      proof.toStation    ?? '',
    DATE:             travelDate,
    DEPARTURE_TIME:   proof.departureTime ?? '',
    ARRIVAL_TIME:     proof.arrivalTime   ?? '',
    OPERATOR:         proof.operator      ?? '',
    TRAIN_NUMBER:     proof.trainNumber   ?? '',
    CLASS_CODE:       proof.classCode     ?? '',
    PLATFORM:         proof.platform      ?? '',
    ESTIMATED_FARE:   estimatedFareLabelFromProof(proof),
    CURRENCY:         isIndia ? 'INR' : 'GBP',
    COUNTRY:          proof.country ?? 'uk',
    DATA_SOURCE:      proof.dataSource    ?? '',
    REAL_TICKET_REF:  '',                   // filled manually / by OpenClaw
    EMAIL_SENT:       'FALSE',             // Make.com scenario 2 checks this
    JOB_ID:           jobId,
    BOOKED_AT:        proof.bookedAt,
  };

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(8_000),
      });
      if (!resp.ok) {
        throw new Error(`Operations webhook HTTP ${resp.status}`);
      }
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError ?? new Error('Operations webhook failed');
}

/**
 * Send a single WhatsApp message via Twilio.
 * `to` must be E.164 format: +447700900123
 */
async function sendWhatsApp(
  accountSid: string,
  authToken:  string,
  from:       string,   // e.g. "whatsapp:+14155238886"
  to:         string,   // e.g. "+447700900123"
  body:       string,
): Promise<void> {
  const toWa = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const creds = btoa(`${accountSid}:${authToken}`);

  const form = new URLSearchParams();
  form.set('From', from);
  form.set('To',   toWa);
  form.set('Body', body);

  await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body:   form.toString(),
    signal: AbortSignal.timeout(8_000),
  });
}

/**
 * Send WhatsApp booking notifications:
 * - Admin alert (always, if ADMIN_WHATSAPP_NUMBER is set)
 * - User confirmation (if proof.whatsappNumber is present)
 */
async function sendBookingWhatsApp(
  env: { TWILIO_ACCOUNT_SID?: string; TWILIO_AUTH_TOKEN?: string; TWILIO_WHATSAPP_FROM?: string; ADMIN_WHATSAPP_NUMBER?: string },
  params: { proof: BookingProof; userEmail?: string; userName?: string; userPhone?: string; userWhatsapp?: string; irctcUsername?: string },
): Promise<void> {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, ADMIN_WHATSAPP_NUMBER } = env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) return;

  const { proof, userEmail, userName, userWhatsapp, irctcUsername } = params;
  const isIndia = proof.country === 'india';
  const isBus = proof.transportMode === 'bus';
  const isGlobal = proof.country === 'global';
  const name = userName?.split(' ')[0] ?? 'Passenger';

  // ── Admin alert ────────────────────────────────────────────────────────────
  if (ADMIN_WHATSAPP_NUMBER) {
    const adminMsg = isIndia
      ? [
          '🚂 *New Bro Booking*',
          `Ref: ${proof.bookingRef}`,
          `Route: ${proof.fromStation} → ${proof.toStation}`,
          `Train: ${proof.trainNumber ?? ''} ${proof.operator}`,
          `Departs: ${proof.departureTime}${proof.arrivalTime ? ` → ${proof.arrivalTime}` : ''}`,
          `Class: ${proof.classCode ?? 'N/A'} · Fare: ${estimatedFareLabelFromProof(proof)}`,
          `User: ${userName ?? 'Unknown'} (${userEmail ?? 'no email'})`,
          irctcUsername ? `IRCTC: ${irctcUsername} (password in admin email)` : '',
          '',
          'Book on IRCTC then update the sheet.',
        ].filter(Boolean).join('\n')
      : isBus
      ? [
          '🚌 *New Bro Booking*',
          `Ref: ${proof.bookingRef}`,
          `Route: ${proof.fromStation} → ${proof.toStation}`,
          `Coach: ${proof.operator}`,
          `Departs: ${proof.departureTime}${proof.arrivalTime ? ` → ${proof.arrivalTime}` : ''}`,
          `Fare: ${estimatedFareLabelFromProof(proof)}`,
          `User: ${userName ?? 'Unknown'} (${userEmail ?? 'no email'})`,
          '',
          'Book with the coach partner then update the sheet.',
        ].filter(Boolean).join('\n')
      : [
          '🚂 *New Bro Booking*',
          `Ref: ${proof.bookingRef}`,
          `Route: ${proof.fromStation} → ${proof.toStation}`,
          `Time: ${proof.departureTime} · ${proof.operator}`,
          proof.platform ? `Platform: ${proof.platform}` : '',
          `Fare: ${estimatedFareLabelFromProof(proof)}`,
          `User: ${userName ?? 'Unknown'} (${userEmail ?? 'no email'})`,
          '',
          isGlobal ? 'Book with the relevant rail partner then update the sheet.' : 'Book on Trainline then update the sheet.',
        ].filter(Boolean).join('\n');

    await sendWhatsApp(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, ADMIN_WHATSAPP_NUMBER, adminMsg).catch(() => {});
  }

  // ── User confirmation ──────────────────────────────────────────────────────
  const userWaNumber = userWhatsapp ?? '';
  if (!userWaNumber) return;

  const userMsg = isIndia
    ? [
        'Bro 🚂',
        '',
        `Hi ${name}, your journey is confirmed.`,
        '',
        `*${proof.fromStation} → ${proof.toStation}*`,
        `${proof.departureTime}${proof.arrivalTime ? ` → ${proof.arrivalTime}` : ''} · ${proof.operator}`,
        proof.classCode ? `Class: ${proof.classCode}` : '',
        '',
        `Reference: *${proof.bookingRef}*`,
        'Your ticket details arrive within 15 minutes.',
        '',
        'Reply HELP if you need anything.',
      ].filter(Boolean).join('\n')
    : isBus
    ? [
        'Bro 🚌',
        '',
        `Hi ${name}, your coach is confirmed.`,
        '',
        `*${proof.fromStation} → ${proof.toStation}*`,
        `${proof.departureTime}${proof.arrivalTime ? ` → ${proof.arrivalTime}` : ''} · ${proof.operator}`,
        '',
        `Reference: *${proof.bookingRef}*`,
        'Your coach details arrive within 15 minutes.',
        '',
        'Reply HELP if you need anything.',
      ].filter(Boolean).join('\n')
    : [
        'Bro 🚂',
        '',
        `Hi ${name}, your journey is confirmed.`,
        '',
        `*${proof.fromStation} → ${proof.toStation}*`,
        `${proof.departureTime} · ${proof.operator}`,
        proof.platform ? `Platform ${proof.platform}` : '',
        '',
        `Reference: *${proof.bookingRef}*`,
        isGlobal ? 'Your booking details arrive within 15 minutes.' : 'Your ticket details arrive within 15 minutes.',
        '',
        'Reply HELP if you need anything.',
      ].filter(Boolean).join('\n');

  await sendWhatsApp(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, userWaNumber, userMsg).catch(() => {});
}

/** Convert a plan item's estimated cost into the user's local currency amount */
function planItemFiatAmount(item: PlanItem, currencyCode: string): number {
  // India train: fare already in INR
  if (item.trainDetails?.country === 'india' && item.trainDetails.fareInr) {
    return item.trainDetails.fareInr;
  }
  // UK/EU train: fare already in GBP — convert to local
  if (item.trainDetails?.estimatedFareGbp) {
    return convertFromGbp(item.trainDetails.estimatedFareGbp, currencyCode);
  }
  // Other services: price in USD (≈ USDC) — convert to local
  return convertFromUsd(item.estimatedPriceUsdc, currencyCode);
}

/** Approximate GBP → local fiat (static rates, display only — not financial) */
function convertFromGbp(gbp: number, code: string): number {
  const rates: Record<string, number> = {
    GBP: 1, USD: 1.27, EUR: 1.18, INR: 107, AUD: 1.96,
    CAD: 1.73, SGD: 1.72, AED: 4.66, JPY: 191, KRW: 1705,
    THB: 46.2, MYR: 6.01, VND: 31100, IDR: 20600,
  };
  return Math.round(gbp * (rates[code] ?? 1) * 100) / 100;
}

/** Approximate USD → local fiat (static rates, display only) */
function convertFromUsd(usd: number, code: string): number {
  const rates: Record<string, number> = {
    USD: 1, GBP: 0.79, EUR: 0.93, INR: 84, AUD: 1.54,
    CAD: 1.36, SGD: 1.35, AED: 3.67, JPY: 150, KRW: 1340,
    THB: 36.4, MYR: 4.73, VND: 24500, IDR: 16200,
  };
  return Math.round(usd * (rates[code] ?? 1) * 100) / 100;
}

function extractText(response: AnthropicResponse): string {
  const textBlock = response.content?.find(b => b.type === 'text') as TextBlock | undefined;
  return (textBlock?.text ?? '').trim();
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: ContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

type ContentBlock = TextBlock | ToolUseBlock;

interface TextBlock {
  type: 'text';
  text: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

/** Live train schedule details captured during Phase 1 — passed through to Phase 2 */
interface TrainDetails {
  departureTime:    string;
  arrivalTime?:     string;
  platform?:        string;
  operator:         string;
  serviceUid:       string;
  origin:           string;
  destination:      string;
  estimatedFareGbp: number;
  // India-specific fields (present when country === 'india')
  country?:         'uk' | 'india' | 'eu' | 'global';
  transportMode?:   'rail' | 'bus';
  trainNumber?:     string;
  trainName?:       string;
  classCode?:       string;
  fareInr?:         number;
  /** Whether this data came from a live API or a scheduled/mock fallback */
  dataSource?:      'darwin_live' | 'national_rail_scheduled' | 'irctc_live' | 'estimated' | 'eu_scheduled' | 'eu_live' | 'global_rail_live' | 'global_rail_scheduled' | 'bus_live' | 'bus_scheduled';
  /** CRS code of the arrival station — used to detect London terminus for TfL final leg */
  destinationCRS?:  string;
  /** Actual travel date (YYYY-MM-DD) — distinct from booking creation date */
  travelDate?:      string;
  /** Full ISO departure datetime — combines travelDate + departureTime for notification scheduling */
  departureDatetime?: string;
  /** TfL final-leg summary (only present when arriving at a London terminus) */
  finalLegSummary?: string;
  finalLegDuration?: number;
}

interface PlanItem {
  toolName:           string;
  toolUseId:          string;
  agentId:            string;
  agentName:          string;
  displayName:        string;
  estimatedPriceUsdc: number;
  input:              Record<string, unknown>;
  trainDetails?:      TrainDetails;
  dataSource?:        string;
  finalLegSummary?:   string;
  /** Encoded polyline + steps — present for navigate tool, used by Meridian map screen */
  routeData?:         RouteData;
  /** Nearby places — present for discover_nearby + book_restaurant tools */
  nearbyPlaces?:      NearbyPlace[];
  /** Flight details — present for search_flights tool; carries offerId for Phase 2 booking */
  flightDetails?: {
    origin: string; destination: string;
    departureAt: string; arrivalAt: string;
    carrier: string; flightNumber: string;
    totalAmount: number; currency: string;
    stops: number; durationMinutes: number; cabinClass: string;
    offerId: string; offerExpiresAt: string; isReturn: boolean;
  };
  /** Hotel details — present for book_hotel tool */
  hotelDetails?: {
    city: string; checkIn: string; checkOut: string;
    bestOption: { name: string; stars: number; ratePerNight: number; totalCost: number; currency: string; area: string; isLive: boolean };
    allOptions: Array<{ name: string; stars: number; ratePerNight: number; totalCost: number; currency: string; area: string; isLive: boolean }>;
  };
  tripContext?:       TripContext;
  journeyId?:         string;
  legIndex?:          number;
}

interface ActionResult {
  toolName:        string;
  displayName:     string;
  agentId:         string;
  agentName:       string;
  jobId:           string;
  agreedPriceUsdc: number;
  input:           Record<string, unknown>;
  status:          'hired' | 'failed';
  trainDetails?:   TrainDetails;
  flightDetails?:  PlanItem['flightDetails'];
  hotelDetails?:   PlanItem['hotelDetails'];
  tripContext?:    TripContext;
  journeyId?:      string;
  legIndex?:       number;
}

interface BookingProof {
  bookingRef:         string;
  departureTime:      string;
  /** Full ISO departure datetime — used by Bro app for notification scheduling */
  departureDatetime?: string;
  arrivalTime?:   string;
  platform?:      string;
  operator:       string;
  fromStation:    string;
  toStation:      string;
  serviceUid:     string;
  fareGbp:        number;
  // India-specific / EU-specific
  country?:       'uk' | 'india' | 'eu' | 'global';
  transportMode?: 'rail' | 'bus';
  fareInr?:       number;
  trainNumber?:   string;
  trainName?:     string;
  classCode?:     string;
  bookedAt:       string;
  note:           string;
  /** True = synthetic ref — schedule data only, no live provider booking */
  isSimulated?:    boolean;
  dataSource?:     string;
  /** Actual travel date (YYYY-MM-DD) — NOT the booking creation date */
  travelDate?:     string;
  /** TfL final-leg summary (e.g. "Piccadilly line (3 stops) → Covent Garden, 12 min") */
  finalLegSummary?: string;
}
