/**
 * concierge.ts — the Meridian concierge brain
 *
 * Full flow:
 *   1. Takes a transcribed intent
 *   2. Finds candidate agents via IntentCoordinator / matchAgents fallback
 *   3. If 2+ candidates → presents tiered choice (budget/balanced/premium) — THIS IS THE PRODUCT
 *   4. If 1 candidate → auto-hire if price <= limit, else needsConfirm (binary)
 *   5. executeHire schedules auto-complete after 12s (until real agent webhooks are wired)
 */

import {
  coordinateIntent,
  hireAgent,
  matchAgents,
  completeJob,
  type Agent,
  type HireResult,
} from './api';
import { speak } from './tts';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ConciergeResult {
  jobId: string;
  agent: Agent;
  agreedPriceUsdc: number;
  coordinationId: string;
}

export interface ConciergeNeedsConfirm {
  needsConfirm: true;
  agent: Agent;
  estimatedPriceUsdc: number;
  coordinationId: string;
  candidateAgents: Agent[];
}

export interface TieredOptions {
  needsChoice: true;
  budget: Agent;
  balanced: Agent;
  premium: Agent;
  coordinationId: string;
  narration: string;
}

export type ConciergeOutcome = ConciergeResult | ConciergeNeedsConfirm | TieredOptions;

// ── Trust / price helpers ─────────────────────────────────────────────────

function trustContext(agent: Agent): string {
  const grade = agent.grade ?? 'B';
  if (agent.verified && (grade === 'A+' || grade === 'A')) return 'verified, top-rated';
  if (agent.verified) return 'verified merchant';
  if (grade === 'A+' || grade === 'A') return 'highly trusted';
  if (grade === 'B') return 'solid track record';
  return 'newer to the network';
}

function priceLabel(p: number | null): string {
  if (p === null || p === 0) return 'free';
  if (p < 1) return `${Math.round(p * 100)} cents`;
  return `$${p.toFixed(2)}`;
}

/**
 * Sort agents into [budget, balanced, premium].
 * Only uses agents with a defined pricePerTaskUsd — unpriced agents can't be tiered.
 * Returns null if fewer than 2 priced agents exist (falls back to single-agent binary flow).
 */
function buildTiers(agents: Agent[]): [Agent, Agent, Agent] | null {
  const priced = agents.filter(a => a.pricePerTaskUsd !== null && a.pricePerTaskUsd !== undefined);
  if (priced.length < 2) return null;

  const sorted = [...priced].sort(
    (a, b) => (a.pricePerTaskUsd ?? 0) - (b.pricePerTaskUsd ?? 0),
  );

  if (sorted.length === 2) return [sorted[0], sorted[0], sorted[1]];

  const cheapest = sorted[0];
  const priciest = sorted[sorted.length - 1];
  // Middle: from remaining, pick highest trust score
  const middle =
    sorted
      .slice(1, -1)
      .sort((a, b) => (b.trustScore ?? 0) - (a.trustScore ?? 0))[0] ?? sorted[1];

  return [cheapest, middle, priciest];
}

function buildNarration(budget: Agent, balanced: Agent, premium: Agent): string {
  const b = `Budget is ${budget.name} at ${priceLabel(budget.pricePerTaskUsd)} — ${trustContext(budget)}.`;
  const m = `Middle is ${balanced.name} at ${priceLabel(balanced.pricePerTaskUsd)} — ${trustContext(balanced)}.`;
  const p = `Premium is ${premium.name} at ${priceLabel(premium.pricePerTaskUsd)} — ${trustContext(premium)}.`;
  return `I found three options. ${b} ${m} ${p} Which would you like — budget, middle, or premium?`;
}

// ── Auto-complete ─────────────────────────────────────────────────────────

/**
 * Schedule job completion after a delay.
 * Keeps the demo loop closed until real agent webhooks are wired.
 * In production, the hired agent calls POST /marketplace/hire/:id/complete.
 */
function scheduleAutoComplete(jobId: string, hirerId: string): void {
  setTimeout(async () => {
    try {
      await completeJob(jobId, hirerId);
    } catch {
      // Agent may have already self-completed — safe to ignore
    }
  }, 30_000); // 30s fallback — real agent webhook fires within ~2s
}

// ── processIntent ─────────────────────────────────────────────────────────

export async function processIntent(params: {
  intent: string;
  hirerId: string;
  autoConfirmLimitUsdc: number;
  openaiKey: string | null;
}): Promise<ConciergeOutcome> {
  const { intent, hirerId, autoConfirmLimitUsdc, openaiKey } = params;

  await speak('Let me find the best options for that.', openaiKey);

  let coordinationId: string;
  let candidates: Agent[];

  try {
    const coordination = await coordinateIntent({
      intent,
      budget: autoConfirmLimitUsdc * 3,
      callerAgentId: hirerId,
    });
    coordinationId = coordination.coordinationId;
    candidates = coordination.plan.candidateAgents;
  } catch {
    const { agents } = await matchAgents({ intent, limit: 10 });
    coordinationId = `direct_${Date.now()}`;
    candidates = agents;
  }

  if (candidates.length === 0) {
    await speak(
      "I couldn't find any agents for that. Could you be more specific?",
      openaiKey,
    );
    throw new Error('NO_AGENTS_FOUND');
  }

  // 2+ candidates → try to build tiered choice (the product moment)
  if (candidates.length >= 2) {
    const tiers = buildTiers(candidates);
    if (tiers) {
      const [budget, balanced, premium] = tiers;
      const narration = buildNarration(budget, balanced, premium);
      await speak(narration, openaiKey);
      return { needsChoice: true, budget, balanced, premium, coordinationId, narration };
    }
  }

  // Single agent — binary auto-hire or confirm
  const best = candidates[0];
  const price = best.pricePerTaskUsd ?? autoConfirmLimitUsdc;

  if (price <= autoConfirmLimitUsdc) {
    await speak(
      `Found ${best.name}. Grade ${best.grade ?? 'B'}. Hiring now for ${priceLabel(price)}.`,
      openaiKey,
    );
    const result = await executeHire({ hirerId, agent: best, jobDescription: intent, coordinationId });
    await speak(`Done. ${best.name} is on it.`, openaiKey);
    return result;
  }

  await speak(
    `I found ${best.name} — ${priceLabel(price)}. Should I go ahead?`,
    openaiKey,
  );
  return {
    needsConfirm: true,
    agent: best,
    estimatedPriceUsdc: price,
    coordinationId,
    candidateAgents: candidates,
  };
}

// ── executeHire ───────────────────────────────────────────────────────────

export async function executeHire(params: {
  hirerId: string;
  agent: Agent;
  jobDescription: string;
  coordinationId: string;
}): Promise<ConciergeResult> {
  const { hirerId, agent, jobDescription, coordinationId } = params;

  const result: { success: boolean } & HireResult = await hireAgent({
    hirerId,
    agentId: agent.agentId,
    jobDescription,
    agreedPriceUsdc: agent.pricePerTaskUsd ?? 1,
  });

  // Auto-complete after delay until the agent has a real webhook handler
  scheduleAutoComplete(result.jobId, hirerId);

  return {
    jobId: result.jobId,
    agent,
    agreedPriceUsdc: result.agreedPriceUsdc,
    coordinationId,
  };
}

// ── statusNarration ───────────────────────────────────────────────────────

export function statusNarration(agent: Agent, elapsedSeconds: number): string {
  if (elapsedSeconds < 10) return `${agent.name} is on it.`;
  if (elapsedSeconds < 30) return `Still working — ${agent.name} is processing your request.`;
  if (elapsedSeconds < 60) return `Almost there. ${agent.name} is finishing up.`;
  return `Taking a bit longer than usual. ${agent.name} is still working.`;
}
