/**
 * concierge.ts — the Meridian concierge brain
 *
 * Handles the full auto-hire loop:
 *   1. Takes a transcribed intent
 *   2. Calls IntentCoordinator to find candidate agents
 *   3. If best agent price <= autoConfirmLimit → auto-hires, no user prompt
 *   4. If price > autoConfirmLimit → returns needsConfirm=true with details
 *      (caller handles voice confirmation, then calls executeHire directly)
 *   5. Tracks job and returns jobId for status polling
 *
 * The concierge narrates each step via TTS.
 */

import { coordinateIntent, hireAgent, matchAgents, type Agent, type HireResult } from './api';
import { speak } from './tts';

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

export type ConciergeOutcome = ConciergeResult | ConciergeNeedsConfirm;

/**
 * Main concierge entry point.
 * Returns either a completed job (auto-hired) or a needs-confirm object.
 */
export async function processIntent(params: {
  intent: string;
  hirerId: string;
  autoConfirmLimitUsdc: number;
  openaiKey: string | null;
}): Promise<ConciergeOutcome> {
  const { intent, hirerId, autoConfirmLimitUsdc, openaiKey } = params;

  await speak("Let me find the best agent for that.", openaiKey);

  // 1. Call IntentCoordinator
  let coordinationId: string;
  let candidates: Agent[];

  try {
    const coordination = await coordinateIntent({
      intent,
      budget: autoConfirmLimitUsdc * 2, // give coordinator headroom
      callerAgentId: hirerId,
    });
    coordinationId = coordination.coordinationId;
    candidates = coordination.plan.candidateAgents;
  } catch {
    // Fallback: direct agent match if IntentCoordinator is down
    const { agents } = await matchAgents({ intent, limit: 5 });
    coordinationId = `direct_${Date.now()}`;
    candidates = agents;
  }

  if (candidates.length === 0) {
    await speak("I couldn't find any agents for that request. Could you rephrase?", openaiKey);
    throw new Error('NO_AGENTS_FOUND');
  }

  // 2. Pick the best agent (first = highest ranked by IntentCoordinator)
  const best = candidates[0];
  const price = best.pricePerTaskUsd ?? autoConfirmLimitUsdc;

  // 3. Decide: auto-hire or ask for confirmation
  if (price <= autoConfirmLimitUsdc) {
    // Auto-hire
    await speak(
      `Found ${best.name}. Trust score ${best.grade}. Hiring now for $${price.toFixed(2)}.`,
      openaiKey,
    );
    const result = await executeHire({ hirerId, agent: best, jobDescription: intent, coordinationId });
    await speak(`Done. ${best.name} is working on it.`, openaiKey);
    return result;
  }

  // Needs voice confirmation
  await speak(
    `I found ${best.name} — the best match. This will cost $${price.toFixed(2)} USDC. Should I go ahead?`,
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

/**
 * Execute the actual hire — called after auto-decision or voice confirmation.
 */
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

  return {
    jobId: result.jobId,
    agent,
    agreedPriceUsdc: result.agreedPriceUsdc,
    coordinationId,
  };
}

/**
 * Generate a natural language narration for status updates.
 */
export function statusNarration(agent: Agent, elapsedSeconds: number): string {
  if (elapsedSeconds < 10) return `${agent.name} is on it.`;
  if (elapsedSeconds < 30) return `Still working — ${agent.name} is processing your request.`;
  if (elapsedSeconds < 60) return `Almost there. ${agent.name} is finishing up.`;
  return `Taking a bit longer than usual. ${agent.name} is still working.`;
}
