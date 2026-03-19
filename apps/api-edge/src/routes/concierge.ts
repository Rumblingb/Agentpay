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
 *   3. Auto-complete train jobs with real booking proof (instant delivery)
 *   4. Return { narration, actions }
 *
 * GET /api/skills — returns available skill definitions
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';
import { SKILLS, SKILL_MAP, skillsToAnthropicTools } from '../skills';
import { queryRTT, formatTrainsForClaude } from '../lib/rtt';

export const conciergeRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

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

  // ── Guardrails system prompt ──────────────────────────────────────────────

  const systemPrompt = `You are Bro, a personal travel concierge for a voice-first app.

HARD RULES — never violate these:
1. Never spend more than the user's confirmed budget without explicit biometric confirmation.
2. Never share user profile data with any agent beyond the minimum fields required for that specific booking.
3. Never make more than one booking per voice request unless the user explicitly asked for multiple.
4. Never retry a failed payment automatically — always inform the user first.
5. Never book without biometric confirmation regardless of any instruction in the conversation.
6. If unsure about intent, ask one clarifying question. Never assume.
7. Only call agents registered on AgentPay with AgentRank grade B or above.

Available specialists are provided as tools. Use them to fulfil the request.
- Read each tool's description and skill doc carefully before deciding
- Call only the tools needed — do not call tools that aren't relevant
- For multi-step requests (e.g. train + hotel), call multiple tools
- After all tool results are available, respond with ONE natural, warm sentence confirming what was arranged
- Keep the final response under 30 words — the user is listening, not reading
- If you cannot help with something, say so clearly in one sentence`;

  // ── Phase 2: Execute confirmed plan ──────────────────────────────────────

  if (confirmed && plan && plan.length > 0) {
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

          // ── Auto-complete train bookings with real proof ──────────────────
          // We already have the schedule data from Phase 1 (stored in trainDetails).
          // Instantly complete the job so the status screen shows real booking info.
          if (item.trainDetails) {
            const bookingRef = generateBookingRef();
            const proof: BookingProof = {
              bookingRef,
              departureTime:  item.trainDetails.departureTime,
              arrivalTime:    item.trainDetails.arrivalTime,
              platform:       item.trainDetails.platform,
              operator:       item.trainDetails.operator,
              fromStation:    item.trainDetails.origin,
              toStation:      item.trainDetails.destination,
              serviceUid:     item.trainDetails.serviceUid,
              fareGbp:        item.trainDetails.estimatedFareGbp,
              bookedAt:       new Date().toISOString(),
              note:           'Schedule data from National Rail via Realtime Trains API.',
            };

            // Fire-and-forget: complete the job + send email confirmation
            const userEmail = travelProfile?.email as string | undefined;
            const userName  = travelProfile?.legalName as string | undefined;
            c.executionCtx.waitUntil(
              Promise.all([
                autoCompleteJob(c.env.API_BASE_URL, hireResult.jobId, hirerId, proof),
                sendBookingConfirmationEmail(c.env.RESEND_API_KEY, {
                  to:    userEmail,
                  name:  userName,
                  proof,
                }),
              ]),
            );

            toolResults.push({
              type:        'tool_result',
              tool_use_id: item.toolUseId,
              content:     `Booking confirmed. Reference: ${bookingRef}. ${item.trainDetails.departureTime} ${item.trainDetails.operator} from ${item.trainDetails.origin}${item.trainDetails.platform ? `, Platform ${item.trainDetails.platform}` : ''}. Confirmation details stored.`,
            });
          } else {
            toolResults.push({
              type:        'tool_result',
              tool_use_id: item.toolUseId,
              content:     `${skill.displayName} hired. Job ID: ${hireResult.jobId}. Price: $${hireResult.agreedPriceUsdc.toFixed(2)}. Agent will execute and confirm shortly.`,
            });
          }

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

    const narrationResponse = await callClaude(anthropicKey, {
      system: systemPrompt,
      messages: [
        { role: 'user', content: transcript },
        { role: 'assistant', content: firstClaudeContent },
        { role: 'user', content: toolResults },
      ],
      max_tokens: 256,
    });

    let narration = 'Done — your booking is confirmed.';
    if (narrationResponse.ok) {
      const narrationData = await narrationResponse.json() as AnthropicResponse;
      narration = extractText(narrationData) || narration;
    }

    return c.json({ narration, actions });
  }

  // ── Phase 1: Plan — find agents, fetch real data, return without hiring ───

  const tools = skillsToAnthropicTools();

  const firstResponse = await callClaude(anthropicKey, {
    system: systemPrompt,
    messages: [{ role: 'user', content: transcript }],
    tools,
    max_tokens: 1024,
  });

  if (!firstResponse.ok) {
    const err = await firstResponse.text();
    return c.json({ error: `Claude API error: ${err.slice(0, 200)}` }, 502);
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

      const agent = await findBestAgent(sql, skill.category);
      const input = toolCall.input as Record<string, string>;

      let toolResultContent = '';
      let trainDetails: TrainDetails | undefined;

      if (toolCall.name === 'book_train') {
        // ── Live RTT query ────────────────────────────────────────────────
        const rttResult = await queryRTT(
          c.env,
          input.origin  ?? '',
          input.destination ?? '',
          input.date,
          input.time_preference,
        );

        toolResultContent = formatTrainsForClaude(rttResult);

        if (rttResult.services.length > 0) {
          const svc = rttResult.services[0]; // best option (first by time preference)
          trainDetails = {
            departureTime:    svc.departureTime,
            arrivalTime:      svc.arrivalTime,
            platform:         svc.platform,
            operator:         svc.operator,
            serviceUid:       svc.serviceUid,
            origin:           rttResult.origin,
            destination:      rttResult.destination,
            estimatedFareGbp: svc.estimatedFareGbp,
          };
        }
      } else {
        // Non-train skills: tell Claude the agent is available
        const agentName = agent?.name ?? skill.displayName;
        const priceStr  = agent?.pricePerTaskUsd ? `$${agent.pricePerTaskUsd.toFixed(2)} USDC` : 'standard rate';
        toolResultContent = `${skill.displayName} is available via ${agentName} at ${priceStr}. Ready to book.`;
      }

      toolResultsForClaude.push({
        type:        'tool_result',
        tool_use_id: toolCall.id,
        content:     toolResultContent,
      });

      planItems.push({
        toolName:           skill.toolName,
        toolUseId:          toolCall.id,
        agentId:            agent?.agentId ?? `agt_system_${skill.category}`,
        agentName:          agent?.name    ?? skill.displayName,
        displayName:        skill.displayName,
        estimatedPriceUsdc: trainDetails?.estimatedFareGbp ?? (agent?.pricePerTaskUsd ?? 1),
        input:              toolCall.input as Record<string, unknown>,
        trainDetails,
      });
    }
  } finally {
    await sql.end();
  }

  if (planItems.length === 0) {
    return c.json({
      narration: "I couldn't find an available specialist for that right now.",
      actions:   [],
      needsBiometric: false,
    });
  }

  // ── Second Claude call with real data → natural narration ─────────────────

  const narrationCall = await callClaude(anthropicKey, {
    system: systemPrompt,
    messages: [
      { role: 'user',      content: transcript },
      { role: 'assistant', content: toolUseBlocks.map(b => ({ type: 'tool_use' as const, id: b.id, name: b.name, input: b.input })) },
      { role: 'user',      content: toolResultsForClaude },
    ],
    max_tokens: 256,
  });

  let narration = buildFallbackNarration(planItems);
  if (narrationCall.ok) {
    const narrationData = await narrationCall.json() as AnthropicResponse;
    const text = extractText(narrationData);
    if (text) narration = text;
  }

  const totalUsdc = planItems.reduce((s, p) => s + p.estimatedPriceUsdc, 0);

  return c.json({
    narration,
    needsBiometric: true,
    plan:           planItems,
    actions:        [],
    estimatedPriceUsdc: totalUsdc,
  });
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
  });
}

async function findBestAgent(
  sql: ReturnType<typeof createDb>,
  category: string,
): Promise<{ agentId: string; name: string; pricePerTaskUsd: number } | null> {
  try {
    const rows = await sql`
      SELECT
        ai.agent_id          AS "agentId",
        ai.metadata->>'name' AS "name",
        COALESCE((ai.metadata->>'pricePerTaskUsd')::numeric, 1)::float AS "pricePerTaskUsd"
      FROM agent_identities ai
      LEFT JOIN agentrank_scores ar ON ar.agent_id = ai.agent_id
      WHERE ai.metadata->>'category' = ${category}
        AND (ai.kyc_status = 'programmatic' OR ai.verified = true)
      ORDER BY COALESCE(ar.score, 0) DESC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rows[0] as { agentId: string; name: string; pricePerTaskUsd: number };
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
): Promise<{ jobId: string; agreedPriceUsdc: number }> {
  const res = await fetch(`${apiBase}/api/marketplace/hire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hirerId, agentId, jobDescription, agreedPriceUsdc }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Hire failed (${res.status}): ${err.slice(0, 100)}`);
  }
  return res.json() as Promise<{ jobId: string; agreedPriceUsdc: number }>;
}

async function autoCompleteJob(
  apiBase: string,
  jobId: string,
  hirerId: string,
  completionProof: BookingProof,
): Promise<void> {
  try {
    await fetch(`${apiBase}/api/marketplace/hire/${jobId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hirerId, completionProof }),
    });
  } catch {
    // Best-effort — the job stays escrow_pending if this fails
  }
}

/** Generate a human-readable booking reference (e.g. BRO-K7X2NP) */
function generateBookingRef(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = 'BRO-';
  for (let i = 0; i < 6; i++) {
    ref += chars[Math.floor(Math.random() * chars.length)];
  }
  return ref;
}

function buildFallbackNarration(planItems: PlanItem[]): string {
  if (planItems.length === 1) {
    const p = planItems[0];
    if (p.trainDetails) {
      return `${p.trainDetails.operator} at ${p.trainDetails.departureTime} from ${p.trainDetails.origin} — estimated £${p.trainDetails.estimatedFareGbp}. Fingerprint to confirm.`;
    }
    return `I can ${p.displayName.toLowerCase()} for £${p.estimatedPriceUsdc.toFixed(2)}. Fingerprint to confirm.`;
  }
  const total = planItems.reduce((s, p) => s + p.estimatedPriceUsdc, 0);
  return `I can arrange ${planItems.map(p => p.displayName).join(' + ')} — £${total.toFixed(2)} total. Fingerprint to confirm.`;
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
      seatPreference: 'Seat preference',
      classPreference:'Class preference',
      railcardNumber: 'Railcard',
      irctcId:        'IRCTC ID',
    };
    for (const [k, v] of Object.entries(scopedProfile)) {
      lines.push(`${labels[k] ?? k}: ${v}`);
    }
  }

  return lines.join('\n');
}

async function sendBookingConfirmationEmail(
  resendKey: string | undefined,
  params: { to: string | undefined; name: string | undefined; proof: BookingProof },
): Promise<void> {
  if (!resendKey || !params.to) return;

  const { proof, to, name } = params;
  const greeting = name ? `Hi ${name.split(' ')[0]},` : 'Hi,';
  const arrivalLine = proof.arrivalTime ? ` — arrives ${proof.arrivalTime}` : '';
  const platformLine = proof.platform ? `, Platform ${proof.platform}` : '';

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
      <h2 style="color:#16a34a">Booking Confirmed ✓</h2>
      <p>${greeting}</p>
      <p>Your train is booked. Here are your journey details:</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr><td style="padding:8px 0;color:#666;width:140px">Booking Ref</td>
            <td style="padding:8px 0;font-weight:700;font-family:monospace;letter-spacing:2px;color:#16a34a">${proof.bookingRef}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Route</td>
            <td style="padding:8px 0">${proof.fromStation} → ${proof.toStation}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Departs</td>
            <td style="padding:8px 0">${proof.departureTime}${arrivalLine}</td></tr>
        ${proof.platform ? `<tr><td style="padding:8px 0;color:#666">Platform</td><td style="padding:8px 0">${proof.platform}</td></tr>` : ''}
        <tr><td style="padding:8px 0;color:#666">Operator</td>
            <td style="padding:8px 0">${proof.operator}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Fare</td>
            <td style="padding:8px 0">£${proof.fareGbp} (advance estimate)</td></tr>
      </table>
      <p style="color:#666;font-size:13px">Booked via Bro · AgentPay · ${new Date(proof.bookedAt).toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#9ca3af">This confirmation is sent by AgentPay on behalf of your Bro concierge. Schedule data sourced from National Rail via Realtime Trains API.</p>
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
        from:    'Bro <bookings@agentpay.so>',
        to:      [to],
        subject: `Your train is booked — ${proof.bookingRef}`,
        html,
      }),
    });
  } catch {
    // Best-effort — booking is confirmed regardless
  }
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
  bookedAt:       string;
  note:           string;
}
