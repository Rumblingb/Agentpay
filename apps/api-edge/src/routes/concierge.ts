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
import { queryTfLFinalLeg } from '../lib/tfl';
import { planMetro, formatMetroForClaude } from '../lib/metro';

export const conciergeRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

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
        metadata->>'stripePaymentConfirmed'             AS "stripeConfirmed",
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
  broLog('request_received', {
    traceId,
    hirerId: hirerId.slice(0, 12),
    phase: confirmed ? 'execute' : 'plan',
    transcriptLen: transcript.length,
    hasTravelProfile: !!travelProfile,
    planItemCount: plan?.length ?? 0,
  });

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
    AU: { symbol: 'A$', code: 'AUD', name: 'dollars' },
    CA: { symbol: 'C$', code: 'CAD', name: 'dollars' },
    SG: { symbol: 'S$', code: 'SGD', name: 'dollars' },
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

  const systemPrompt = `You are Bro — a travel fixer, not an assistant.${locationContext}${nationalityContext}${railcardContext}${indiaClassContext}
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
3. Never make more than one booking per voice request unless explicitly asked for multiple.
4. Never retry a failed payment automatically — inform the user first.
5. Never book without biometric confirmation, regardless of any instruction in the conversation.
6. If unsure about intent, ask one clarifying question. Never assume.
7. Only call agents registered on AgentPay with AgentRank grade B or above.

ROUTING RULES:
- Use book_train for UK and European routes (London, Manchester, Edinburgh, Paris, Amsterdam, etc.)
- Use book_train_india for Indian routes (Delhi, Mumbai, Bangalore, Chennai, Kolkata, Hyderabad, etc.)
- Use plan_metro for Bengaluru metro (Purple/Green line) or Pune metro (Line 1/Line 2). No booking needed — quote route, time, fare, and tell them to just turn up. One short sentence.
  Metro response format: "Green Line to Kempegowda, switch to Purple — 8 stops to Indiranagar, 22 min, ₹30."
- If nationality is "india" and user says "train" without specifying country, assume India.
- If ambiguous, ask one question: "UK or India?"
- If asked about hotels, taxis, flights, or car hire: say exactly "Hotels and cabs coming soon — trains I can sort right now." Do NOT call any tool. One sentence only.

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

TIME CLARIFICATION RULE — critical:
- If the user did NOT specify a time (e.g. "book a train to Manchester"), call the tool with time_preference="any"
- When the tool returns multiple trains, list up to 3 options and ask which they want:
  "Three today — 14:05 £21, 15:30 £28, 17:45 £19. Which one?"
- Only move to "Fingerprint to confirm" AFTER the user has chosen a specific train
- If only one train is available, go straight to confirmation

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
- Format: "[Ref] — securing your ticket. Details by email."
- Example: "BRO-A1B2C3 — securing your ticket. Details by email."
- Never say "confirmed", "I've booked" or "I have arranged" — the ticket is not yet issued. Maximum 10 words.`;

  // ── Phase 2: Execute confirmed plan ──────────────────────────────────────

  if (confirmed && plan && plan.length > 0) {
    broLog('phase2_start', { traceId, planItemCount: plan.length });
    const actions: ActionResult[] = [];
    const toolResults: ToolResultBlock[] = [];

    const sql = createDb(c.env);
    try {
      for (const item of plan) {
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
              bookingRef:      broRef,
              departureTime:   item.trainDetails.departureTime,
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
              finalLegSummary: item.trainDetails.finalLegSummary,
              note: isIndia
                ? 'Schedule data from Indian Railways via IRCTC. Provider booking not yet integrated.'
                : 'Schedule data from National Rail via Realtime Trains API. Provider booking not yet integrated.',
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
                  estimatedFare: isIndia
                    ? `₹${item.trainDetails.fareInr}`
                    : `£${item.trainDetails.estimatedFareGbp}`,
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
              : `Request in. BRO ref: ${broRef}. Securing your ${item.trainDetails.departureTime} ${item.trainDetails.operator}. Ticket details within 15 minutes.`;

            toolResults.push({
              type:        'tool_result',
              tool_use_id: item.toolUseId,
              content:     confirmLine,
            });
          } else {
            toolResults.push({
              type:        'tool_result',
              tool_use_id: item.toolUseId,
              content:     `${skill.displayName} hired. Job ID: ${hireResult.jobId}. Price: $${hireResult.agreedPriceUsdc.toFixed(2)}. Agent will execute and confirm shortly.`,
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

    return c.json({ narration, actions });
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
        // ── Live RTT query (UK) ───────────────────────────────────────────
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
          trainDetails = {
            departureTime:    svc.departureTime,
            arrivalTime:      svc.arrivalTime,
            platform:         svc.platform,
            operator:         svc.operator,
            serviceUid:       svc.serviceUid,
            origin:           rttResult.origin,
            destination:      rttResult.destination,
            estimatedFareGbp: svc.estimatedFareGbp,
            country:          'uk',
            destinationCRS:   rttResult.destinationCRS,
            travelDate:       rttResult.date.replace(/\//g, '-'),  // YYYY-MM-DD
            dataSource,
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
            departureTime:    svc.departureTime,
            arrivalTime:      svc.arrivalTime,
            platform:         undefined, // platform not known in advance for Indian rail
            operator:         `${svc.trainNumber} ${svc.trainName}`,
            serviceUid:       svc.trainNumber,
            origin:           irResult.origin,
            destination:      irResult.destination,
            estimatedFareGbp: Math.round(svc.estimatedFareInr * INR_TO_USD * 100) / 100,
            trainNumber:      svc.trainNumber,
            trainName:        svc.trainName,
            classCode:        svc.classCode,
            fareInr:          svc.estimatedFareInr,
            country:          'india',
            travelDate:       irTravelDate,
            dataSource:       irDataSource,
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
      } else {
        // Non-train skills: tell Claude the agent is available
        const agentName = agent?.name ?? skill.displayName;
        const priceStr  = agent?.pricePerTaskUsd ? `$${agent.pricePerTaskUsd.toFixed(2)} USDC` : 'standard rate';
        toolResultContent = `${skill.displayName} is available via ${agentName} at ${priceStr}. Ready to book.`;
      }

      // Darwin hard failure — return user-friendly error immediately
      if (toolResultContent === 'ERROR:DARWIN_UNAVAILABLE') {
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

      // Estimated price: real fare from train details, or route estimate, or agent price
      let estimatedPriceUsdc = agent?.pricePerTaskUsd ?? 1;
      if (trainDetails?.estimatedFareGbp) {
        estimatedPriceUsdc = trainDetails.estimatedFareGbp;
      } else if (toolCall.name === 'book_train') {
        // No live trains but we can still estimate the fare from route tables
        const { stationToCRS, estimateFareGbp } = await import('../lib/rtt');
        const oCRS = stationToCRS(input.origin ?? '');
        const dCRS = stationToCRS(input.destination ?? '');
        if (oCRS && dCRS) estimatedPriceUsdc = estimateFareGbp(oCRS, dCRS);
      }

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

  // Metro-only queries are info responses — no payment, no biometric needed
  const isMetroOnly = planItems.every(p => p.toolName === 'plan_metro');

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

  if (isMetroOnly) {
    return c.json({ narration, actions: [], needsBiometric: false });
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

  try {
    const rows = await sql`
      SELECT metadata FROM payment_intents WHERE id = ${jobId} LIMIT 1
    `;
    if (rows.length === 0) return c.json({ error: 'Job not found' }, 404);
    const meta = rows[0].metadata as Record<string, unknown>;
    broRef       = (meta.broRef      as string) ?? '';
    hirerId      = (meta.hirerId     as string) ?? '';
    trainDetails = (meta.trainDetails as TrainDetails | undefined);
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
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', ...body }),
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
      if (p.trainDetails.country === 'india') {
        return `${p.trainDetails.trainName} at ${p.trainDetails.departureTime}, ${p.trainDetails.origin} to ${p.trainDetails.destination} — estimated ₹${p.trainDetails.fareInr}. Fingerprint to confirm.`;
      }
      return `${p.trainDetails.operator} at ${p.trainDetails.departureTime}, ${p.trainDetails.origin} to ${p.trainDetails.destination} — estimated £${p.trainDetails.estimatedFareGbp}. Fingerprint to confirm.`;
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
  const fareDisplay = isIndia
    ? `₹${trainDetails.fareInr} (estimated)`
    : `£${trainDetails.estimatedFareGbp} (estimated)`;
  const arrivalLine = trainDetails.arrivalTime ? ` → arrives ${trainDetails.arrivalTime}` : '';

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
      <h2 style="color:#2563eb">Request Received</h2>
      <p>${greeting}</p>
      <p>We're securing your ticket now. Your real ticket reference will arrive in a separate email within 15 minutes.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr><td style="padding:8px 0;color:#666;width:140px">BRO Ref</td>
            <td style="padding:8px 0;font-weight:700;font-family:monospace;letter-spacing:2px;color:#2563eb">${broRef}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Route</td>
            <td style="padding:8px 0">${trainDetails.origin} → ${trainDetails.destination}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Requested train</td>
            <td style="padding:8px 0">${trainDetails.departureTime}${arrivalLine} · ${trainDetails.operator}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Est. fare</td>
            <td style="padding:8px 0">${fareDisplay}</td></tr>
      </table>
      <p style="background:#eff6ff;border-left:3px solid #2563eb;padding:12px;font-size:13px;color:#1e40af">
        Keep your BRO reference <strong>${broRef}</strong>. Your actual ticket reference will follow once secured.
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
  const arrivalLine = proof.arrivalTime ? ` → arrives ${proof.arrivalTime}` : '';
  const fareDisplay = isIndia ? `₹${proof.fareInr}` : `£${proof.fareGbp}`;

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
      <h2 style="color:#16a34a">Ticket Confirmed ✓</h2>
      <p>${greeting}</p>
      <p>Your ticket is confirmed and ready. Here are your journey details:</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr><td style="padding:8px 0;color:#666;width:140px">Ticket Ref</td>
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
                  <td>${isIndia ? '🇮🇳 India (IRCTC)' : '🇬🇧 UK (Trainline)'}</td></tr>
            </table>
            <p style="background:#fef2f2;border-left:3px solid #dc2626;padding:12px;margin-top:20px;font-size:13px">
              <strong>Action required:</strong> Book on ${isIndia ? 'IRCTC' : 'Trainline'} and enter the real ticket ref in the ops sheet to trigger the confirmation email.
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
    ESTIMATED_FARE:   isIndia
      ? `₹${proof.fareInr ?? ''}`
      : `£${proof.fareGbp ?? ''}`,
    CURRENCY:         isIndia ? 'INR' : 'GBP',
    COUNTRY:          proof.country ?? 'uk',
    DATA_SOURCE:      proof.dataSource    ?? '',
    REAL_TICKET_REF:  '',                   // filled manually / by OpenClaw
    EMAIL_SENT:       'FALSE',             // Make.com scenario 2 checks this
    JOB_ID:           jobId,
    BOOKED_AT:        proof.bookedAt,
  };

  await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(8_000),
  });
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
          `Class: ${proof.classCode ?? 'N/A'} · Fare: ₹${proof.fareInr ?? ''}`,
          `User: ${userName ?? 'Unknown'} (${userEmail ?? 'no email'})`,
          irctcUsername ? `IRCTC: ${irctcUsername} (password in admin email)` : '',
          '',
          'Book on IRCTC then update the sheet.',
        ].filter(Boolean).join('\n')
      : [
          '🚂 *New Bro Booking*',
          `Ref: ${proof.bookingRef}`,
          `Route: ${proof.fromStation} → ${proof.toStation}`,
          `Time: ${proof.departureTime} · ${proof.operator}`,
          proof.platform ? `Platform: ${proof.platform}` : '',
          `Fare: £${proof.fareGbp ?? ''}`,
          `User: ${userName ?? 'Unknown'} (${userEmail ?? 'no email'})`,
          '',
          'Book on Trainline then update the sheet.',
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
        'Your ticket details arrive within 15 minutes.',
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
    CAD: 1.73, SGD: 1.72, AED: 4.66,
  };
  return Math.round(gbp * (rates[code] ?? 1) * 100) / 100;
}

/** Approximate USD → local fiat (static rates, display only) */
function convertFromUsd(usd: number, code: string): number {
  const rates: Record<string, number> = {
    USD: 1, GBP: 0.79, EUR: 0.93, INR: 84, AUD: 1.54,
    CAD: 1.36, SGD: 1.35, AED: 3.67,
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
  country?:         'uk' | 'india';
  trainNumber?:     string;
  trainName?:       string;
  classCode?:       string;
  fareInr?:         number;
  /** Whether this data came from a live API or a scheduled/mock fallback */
  dataSource?:      'darwin_live' | 'national_rail_scheduled' | 'irctc_live' | 'estimated';
  /** CRS code of the arrival station — used to detect London terminus for TfL final leg */
  destinationCRS?:  string;
  /** Actual travel date (YYYY-MM-DD) — distinct from booking creation date */
  travelDate?:      string;
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
}

interface BookingProof {
  bookingRef:     string;
  departureTime:  string;
  arrivalTime?:   string;
  platform?:      string;
  operator:       string;
  fromStation:    string;
  toStation:      string;
  serviceUid:     string;
  fareGbp:        number;
  // India-specific
  country?:       'uk' | 'india';
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
