/**
 * concierge.ts — thin client over the server-side Bro brain
 *
 * All intelligence (Claude + skill files + guardrails + agent selection)
 * lives on the server. This module handles the two-phase flow:
 *
 * Phase 1: plan   — transcript → server → narration + price (no hire)
 * Phase 2: execute — plan + biometric confirmation → server → hire + narration
 */

import { conciergeIntent, conciergeConfirm, type ConciergeResponse, type ConciergePlanItem } from './api';
export type { ConciergeResponse, ConciergePlanItem };

/** Phase 1 — get a plan from Claude. Does NOT hire anything. */
export async function planIntent(params: {
  transcript: string;
  hirerId: string;
  travelProfile?: Record<string, unknown>;
}): Promise<ConciergeResponse> {
  return conciergeIntent(params);
}

/** Phase 2 — execute the plan after biometric confirmation. Fires the hire. */
export async function executeIntent(params: {
  transcript: string;
  hirerId: string;
  travelProfile?: Record<string, unknown>;
  plan: ConciergePlanItem[];
}): Promise<ConciergeResponse> {
  return conciergeConfirm(params);
}
