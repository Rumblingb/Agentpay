/**
 * concierge.ts — thin client over the server-side Bro brain
 *
 * All intelligence (Claude + skill files + guardrails + agent selection)
 * lives on the server. This module handles the two-phase flow:
 *
 * Phase 1: plan   — transcript → server → narration + price (no hire)
 * Phase 2: execute — plan + biometric confirmation → server → hire + narration
 */

import { conciergeIntent, conciergeConfirm, type ConciergeResponse, type ConciergePlanItem, type BroTravelProfile } from './api';
export type { ConciergeResponse, ConciergePlanItem, BroTravelProfile };

// ── Legacy type stubs (used by store.ts) ─────────────────────────────────────
// These types exist for backwards compatibility with the store shape.
// The two-phase flow supersedes the old tiered/confirm patterns.

/** @deprecated — superseded by two-phase plan/execute flow */
export interface TieredOptions {
  budget:   { agentId: string; name: string; priceUsdc: number; description: string } | null;
  standard: { agentId: string; name: string; priceUsdc: number; description: string } | null;
  premium:  { agentId: string; name: string; priceUsdc: number; description: string } | null;
  capability: string;
  intent: string;
}

/** @deprecated — superseded by two-phase plan/execute flow */
export interface ConciergeNeedsConfirm {
  agentId:     string;
  agentName:   string;
  priceUsdc:   number;
  description: string;
  capability:  string;
  intent:      string;
}

// ── Phase 1: plan ─────────────────────────────────────────────────────────────

/** Phase 1 — get a plan from Claude. Does NOT hire anything. */
export async function planIntent(params: {
  transcript: string;
  hirerId: string;
  travelProfile?: BroTravelProfile;
}): Promise<ConciergeResponse> {
  return conciergeIntent(params);
}

// ── Phase 2: execute ─────────────────────────────────────────────────────────

/** Phase 2 — execute the plan after biometric confirmation. Fires the hire. */
export async function executeIntent(params: {
  transcript: string;
  hirerId: string;
  travelProfile?: BroTravelProfile;
  plan: ConciergePlanItem[];
}): Promise<ConciergeResponse> {
  return conciergeConfirm(params);
}

// ── Status narration ──────────────────────────────────────────────────────────

const STATUS_LINES = [
  'Ace is checking the live route now.',
  'Ace is holding the strongest available option.',
  'Ace is carrying the booking through fulfilment.',
  'Ace is keeping the trip together while the ticket issues.',
  'Ace is still on it. You do not need to start over.',
];

/**
 * Generate a periodic status narration while a job is executing.
 * Called every 20 seconds from the status screen.
 */
export function statusNarration(
  agent: { name?: string } | null,
  elapsedSeconds: number,
): string {
  const idx   = Math.floor(elapsedSeconds / 20) % STATUS_LINES.length;
  const line  = STATUS_LINES[idx];
  const name  = agent?.name;
  return name ? `${name}: ${line}` : line;
}
