/**
 * Copyright (c) 2026 AgentPay
 * AgentPay™ is a trademark of AgentPay Ltd.
 * Licensed under Business Source License (BSL); converts to AGPL-3.0 after 2029-01-01.
 * Intent Resolution Engine (Phase 6)
 *
 * The core interpreter for AgentPay's settlement layer.  Transforms a raw
 * NormalizedProof (from Phase 5 ingestion) into a deterministic, auditable
 * resolution record — replacing the ad-hoc "verification_failed" dead end
 * that existed before Phase 6.
 *
 * ── Evaluation order (sequential, short-circuit on first failure) ─────────
 *
 *   1. Identity match   — proof.recipient / externalRef vs settlement identity
 *   2. Amount match     — observed vs expected, with fee + partial tolerances
 *   3. Memo/reference   — memo vs verificationToken (when requireMemoMatch=true)
 *   4. Policy eval      — feeSourcePolicy, amountMode, confidence score
 *
 * ── Decision codes ────────────────────────────────────────────────────────
 *
 *   matched                  All checks passed; exact amount + identity + memo
 *   matched_with_external_fee Amount short by ≤ FEE_TOLERANCE_USDC
 *   partial_match            Identity ok; amount short beyond fee but < 5 %
 *   underpaid                Amount significantly below expected
 *   overpaid                 Amount exceeds expected (policy typically accepts)
 *   unmatched                Identity check failed
 *   rejected                 Policy explicitly rejects (memo required but absent)
 *
 * ── Protocol support ──────────────────────────────────────────────────────
 *
 *   ✓  solana   — direct mode (by_recipient + optional memo match)
 *   ~  stripe   — stub ready for Phase 7 (by_external_ref)
 *   ~  ap2      — stub ready for Phase 7 (by_external_ref)
 *   ~  x402     — stub ready for Phase 7 (by_external_ref)
 *   ~  acp      — stub ready for Phase 7 (by_external_ref)
 *   ~  agent    — stub ready for Phase 7 (by_external_ref)
 *
 * @module settlement/intentResolutionEngine
 */

import prisma from '../lib/prisma.js';
import { logger } from '../logger.js';
import { resolveIntent } from '../../packages/agentpay-core/settlement/intentResolutionService.js';
import { getActiveByIntentAndProtocol, getSettlementIdentityById } from '../../packages/agentpay-core/settlement/settlementIdentityService.js';
import { emitSettlementEvent } from '../../packages/agentpay-core/settlement/settlementEventService.js';
import type { NormalizedProof } from '../../packages/agentpay-core/settlement/settlementEventIngestion.js';
import type {
  IntentResolutionRecord,
  MatchingPolicyRecord,
  MatchStrategy,
  ResolutionDecision,
  ReasonCode,
  ResolutionStatus,
  ResolvedBy,
  SettlementIdentityRecord,
  SettlementProtocol,
} from '../../packages/agentpay-core/settlement/types.js';
import { getResolution } from '../../packages/agentpay-core/settlement/intentResolutionService.js';

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/**
 * Maximum USDC shortfall attributable to an external fee (exchange withdrawal
 * fee, routing fee, etc.) without failing the amount check.
 *
 * Rational: Solana on-chain USDC transfers carry no USDC fee — fees are paid
 * in SOL — so this covers CEX-withdrawal deductions and float rounding only.
 * $0.02 is intentionally conservative; raise it via policy.config.feeTolerance
 * once there is empirical data.
 */
export const FEE_TOLERANCE_USDC = 0.02;

/**
 * Maximum fractional underpayment that produces partial_match rather than
 * underpaid.  5 % of the expected amount.
 *
 * Example: intent = $10.00; anything from $9.50 to $9.98 is partial_match;
 * below $9.50 is underpaid; above $10.00 is overpaid.
 */
export const PARTIAL_TOLERANCE_PCT = 0.05;

// ---------------------------------------------------------------------------
// Public input / output types
// ---------------------------------------------------------------------------

/** All inputs required to run the engine for a single intent + proof. */
export interface RunEngineParams {
  /** The payment intent being resolved. */
  intentId: string;
  /** Normalized proof from Phase 5 ingestion. */
  proof: NormalizedProof;
  /**
   * Expected settlement amount in USDC (cast from payment_intents.amount).
   * Used for the amount-match step.
   */
  expectedAmountUsdc: number;
  /**
   * Merchant's Solana wallet address — the *recipient* checked for
   * by_recipient matching.  Null for non-Solana protocols.
   */
  merchantWallet: string | null;
  /**
   * payment_intents.verification_token — compared against proof.memo when
   * the active policy has requireMemoMatch=true.
   */
  verificationToken: string | null;
  /** Which subsystem is invoking the engine (written to intent_resolutions). */
  resolvedBy: ResolvedBy;
  /**
   * Pre-loaded settlement identity ID, if the caller already has it.
   * Skips the DB lookup when provided.
   */
  settlementIdentityId?: string;
}

/** Fine-grained result of the pure evaluation step. */
export interface EvaluationResult {
  /** The engine's decision for this proof + intent combination. */
  decision: ResolutionDecision;
  /** Machine-readable reason for the decision. */
  reasonCode: ReasonCode;
  /** DB-safe coarse status (confirmed / failed / disputed / expired). */
  resolutionStatus: ResolutionStatus;
  /** Engine certainty, 0.000–1.000.  1.0 = certain; 0.0 = no confidence. */
  confidenceScore: number;
  /** Whether the identity check passed. */
  identityMatched: boolean;
  /** Whether the amount check passed. */
  amountMatched: boolean;
  /**
   * Whether the memo/reference check passed.
   * Always true when requireMemoMatch=false.
   */
  metaMatched: boolean;
  /** Amount in the proof (USDC).  Null when the proof carries no amount. */
  observedAmount: number | null;
  /** Expected amount from payment_intents.amount. */
  expectedAmount: number;
  /**
   * observedAmount − expectedAmount.
   * Positive = overpayment; negative = shortfall; null = observedAmount unknown.
   */
  delta: number | null;
}

/** Full output of runResolutionEngine(). */
export interface EngineRunResult {
  /** The persisted intent_resolutions record. */
  resolution: IntentResolutionRecord;
  /** The evaluation that produced the resolution. */
  evaluation: EvaluationResult;
  /** True when the intent was already resolved before this run (idempotent). */
  wasAlreadyResolved: boolean;
}

// ---------------------------------------------------------------------------
// Internal evaluation context (pure, no DB)
// ---------------------------------------------------------------------------

interface EvalContext {
  intentId: string;
  expectedAmountUsdc: number;
  merchantWallet: string | null;
  verificationToken: string | null;
  settlementIdentity: SettlementIdentityRecord | null;
  policy: MatchingPolicyRecord | null;
}

// ---------------------------------------------------------------------------
// Decision → DB status mapping
// ---------------------------------------------------------------------------

/**
 * Map a fine-grained ResolutionDecision to the coarser DB-safe ResolutionStatus.
 * Explicit switch — no fall-through — so every decision is accounted for.
 */
export function toResolutionStatus(decision: ResolutionDecision): ResolutionStatus {
  switch (decision) {
    case 'matched':
    case 'matched_with_external_fee':
    case 'overpaid':
      return 'confirmed';
    case 'partial_match':
    case 'underpaid':
    case 'unmatched':
    case 'rejected':
      return 'failed';
  }
}

/**
 * Map a ResolutionStatus to the payment_intents.status value set when the
 * engine closes an intent.
 */
export function toIntentStatus(resolutionStatus: ResolutionStatus): string {
  switch (resolutionStatus) {
    case 'confirmed': return 'completed';
    case 'failed':    return 'failed';
    case 'expired':   return 'expired';
    case 'disputed':  return 'failed';
  }
}

/**
 * Assign a confidence score to each decision.
 * 1.0 = engine is certain; 0.0 = engine has no confidence.
 */
export function toConfidenceScore(decision: ResolutionDecision): number {
  switch (decision) {
    case 'matched':                   return 1.0;
    case 'overpaid':                  return 0.95;
    case 'matched_with_external_fee': return 0.92;
    case 'partial_match':             return 0.65;
    case 'underpaid':                 return 0.25;
    case 'unmatched':                 return 0.0;
    case 'rejected':                  return 0.0;
  }
}

// ---------------------------------------------------------------------------
// Step 1 — Identity match
// ---------------------------------------------------------------------------

interface IdentityStepResult {
  matched: boolean;
  reasonCode: ReasonCode;
}

/**
 * Solana direct-mode identity match.
 *
 * by_recipient:    proof.recipient === merchantWallet
 * by_memo:         proof.memo      === verificationToken
 * by_external_ref: proof.externalRef === settlementIdentity.externalRef
 *
 * We do NOT reject on missing memo here — that is deferred to the meta step
 * so that recipient-only confirmation can still be classified intelligibly.
 */
function matchSolanaIdentity(
  proof: NormalizedProof,
  ctx: EvalContext,
  strategy: MatchStrategy,
): IdentityStepResult {
  if (strategy === 'by_recipient') {
    if (!ctx.merchantWallet) {
      logger.warn('[ResolutionEngine] merchantWallet missing for by_recipient match', {
        intentId: ctx.intentId,
      });
      return { matched: false, reasonCode: 'recipient_mismatch' };
    }
    const matched = proof.recipient === ctx.merchantWallet;
    return {
      matched,
      reasonCode: matched ? 'identity_confirmed' : 'recipient_mismatch',
    };
  }

  if (strategy === 'by_memo') {
    if (!proof.memo) return { matched: false, reasonCode: 'memo_missing' };
    const matched = proof.memo === ctx.verificationToken;
    return {
      matched,
      reasonCode: matched ? 'identity_confirmed' : 'memo_mismatch',
    };
  }

  // by_external_ref: compare proof identifier against settlement identity ref
  if (strategy === 'by_external_ref') {
    const identityRef = ctx.settlementIdentity?.externalRef ?? null;
    if (!identityRef) return { matched: false, reasonCode: 'no_settlement_identity' };
    const matched = proof.externalRef === identityRef;
    return {
      matched,
      reasonCode: matched ? 'identity_confirmed' : 'external_ref_mismatch',
    };
  }

  return { matched: false, reasonCode: 'protocol_not_supported' };
}

/**
 * Stripe identity match stub.
 *
 * Stripe sessions are matched by externalRef — the Stripe session / PI ID
 * stored on the settlement identity when the intent was created.
 *
 * @hook Phase 7+ full Stripe Connect reconciliation
 */
function matchStripeIdentity(
  proof: NormalizedProof,
  ctx: EvalContext,
): IdentityStepResult {
  const identityRef = ctx.settlementIdentity?.externalRef ?? null;
  if (!identityRef) return { matched: false, reasonCode: 'no_settlement_identity' };
  const matched = proof.externalRef === identityRef;
  return {
    matched,
    reasonCode: matched ? 'identity_confirmed' : 'external_ref_mismatch',
  };
}

/**
 * Generic external-ref identity match — used for AP2, x402, ACP, agent rails.
 *
 * @hook Phase 7+ per-protocol refinement
 */
function matchExternalRefIdentity(
  proof: NormalizedProof,
  ctx: EvalContext,
): IdentityStepResult {
  const identityRef = ctx.settlementIdentity?.externalRef ?? null;
  if (!identityRef) return { matched: false, reasonCode: 'no_settlement_identity' };
  const matched = proof.externalRef === identityRef;
  return {
    matched,
    reasonCode: matched ? 'identity_confirmed' : 'external_ref_mismatch',
  };
}

/** Step 1 dispatcher: route to the correct protocol matcher. */
function stepIdentityMatch(
  proof: NormalizedProof,
  ctx: EvalContext,
): IdentityStepResult {
  if (!ctx.settlementIdentity) {
    return { matched: false, reasonCode: 'no_settlement_identity' };
  }
  if (!ctx.policy) {
    return { matched: false, reasonCode: 'no_matching_policy' };
  }

  const strategy = ctx.policy.matchStrategy as MatchStrategy;

  switch (proof.protocol) {
    case 'solana':
      return matchSolanaIdentity(proof, ctx, strategy);
    case 'stripe':
      return matchStripeIdentity(proof, ctx);
    case 'ap2':
    case 'x402':
    case 'acp':
    case 'agent':
      return matchExternalRefIdentity(proof, ctx);
    default:
      return { matched: false, reasonCode: 'protocol_not_supported' };
  }
}

// ---------------------------------------------------------------------------
// Step 2 — Amount match
// ---------------------------------------------------------------------------

interface AmountStepResult {
  matched: boolean;
  /**
   * Non-null when the amount step wants to force a specific decision code,
   * e.g. 'overpaid', 'underpaid', 'matched_with_external_fee'.
   * Null means "amount check passed; let later steps decide".
   */
  decision: ResolutionDecision | null;
  reasonCode: ReasonCode;
  delta: number | null;
}

type AmountMode = 'exact' | 'at_least' | 'any';

/**
 * Step 2: Amount match.
 *
 * Gross vs net logic
 * ──────────────────
 * grossAmount — what the payer sent before any fee deductions (available
 *               for Solana on-chain + Stripe webhooks at ingestion time).
 * netAmount   — what the merchant received after fees (null at ingestion).
 *
 * For Phase 6 Solana direct mode grossAmount IS the received amount because
 * Solana USDC transfers have no USDC fee (network fees are paid in SOL).
 * We therefore compare proof.grossAmount against expectedAmountUsdc.
 *
 * Fee tolerance
 * ─────────────
 * A shortfall ≤ FEE_TOLERANCE_USDC → matched_with_external_fee.
 * Covers exchange/CEX withdrawal fees deducted before on-chain transfer.
 *
 * Partial tolerance
 * ─────────────────
 * A shortfall > fee tolerance but ≤ PARTIAL_TOLERANCE_PCT of expected
 * → partial_match.  Below that threshold → underpaid.
 */
function stepAmountMatch(
  proof: NormalizedProof,
  ctx: EvalContext,
): AmountStepResult {
  const observed = proof.grossAmount;
  const expected = ctx.expectedAmountUsdc;

  // Proof carries no amount — cannot complete amount check
  if (observed === null) {
    return {
      matched: false,
      decision: 'unmatched',
      reasonCode: 'amount_mismatch',
      delta: null,
    };
  }

  const delta = observed - expected;

  // Pull amountMode from policy config; default to 'exact'
  const config = ctx.policy?.config as Record<string, unknown> | null;
  const feeTolerance = typeof config?.feeTolerance === 'number'
    ? config.feeTolerance
    : FEE_TOLERANCE_USDC;
  const amountMode: AmountMode = (config?.amountMode as AmountMode) ?? 'exact';

  // ── any: accept any positive amount ──────────────────────────────────────
  if (amountMode === 'any') {
    const ok = observed > 0;
    return {
      matched: ok,
      decision: ok ? null : 'unmatched',
      reasonCode: ok ? 'exact_amount' : 'amount_mismatch',
      delta,
    };
  }

  // ── at_least: payer must send >= expected ─────────────────────────────────
  if (amountMode === 'at_least') {
    if (observed >= expected) {
      return {
        matched: true,
        decision: delta > 0 ? 'overpaid' : null,
        reasonCode: delta > 0 ? 'overpay_accepted' : 'exact_amount',
        delta,
      };
    }
    return { matched: false, decision: 'underpaid', reasonCode: 'amount_mismatch', delta };
  }

  // ── exact (default) ───────────────────────────────────────────────────────
  if (delta === 0) {
    return { matched: true, decision: null, reasonCode: 'exact_amount', delta: 0 };
  }

  if (delta > 0) {
    // Overpayment — accepted but labelled
    return { matched: true, decision: 'overpaid', reasonCode: 'overpay_accepted', delta };
  }

  // Underpayment — apply tolerance bands
  const shortfall = Math.abs(delta);

  if (shortfall <= feeTolerance) {
    return {
      matched: true,
      decision: 'matched_with_external_fee',
      reasonCode: 'external_fee_detected',
      delta,
    };
  }

  const partialThreshold = expected * PARTIAL_TOLERANCE_PCT;
  if (shortfall <= partialThreshold) {
    return {
      matched: false,
      decision: 'partial_match',
      reasonCode: 'amount_mismatch',
      delta,
    };
  }

  return { matched: false, decision: 'underpaid', reasonCode: 'amount_mismatch', delta };
}

// ---------------------------------------------------------------------------
// Step 3 — Memo / reference match
// ---------------------------------------------------------------------------

interface MetaStepResult {
  matched: boolean;
  reasonCode: ReasonCode;
}

/**
 * Step 3: Memo / reference match.
 *
 * Only enforced when policy.requireMemoMatch is true.
 * For Solana Pay, the memo field carries the verificationToken.
 *
 * This step runs AFTER identity and amount checks — a missing memo alone
 * does not prevent an identity-confirmed + amount-matched proof from being
 * accepted unless the policy explicitly requires it.
 *
 * Gross/net split: we check proof.memo (Solana Pay memo) or proof.externalRef
 * depending on protocol.  For all current protocols, proof.memo is the right
 * field for the verificationToken comparison.
 */
function stepMetaMatch(
  proof: NormalizedProof,
  ctx: EvalContext,
): MetaStepResult {
  const requireMemo = ctx.policy?.requireMemoMatch ?? false;

  if (!requireMemo) {
    // Policy does not require memo — pass unconditionally
    return { matched: true, reasonCode: 'identity_confirmed' };
  }

  if (!proof.memo) {
    return { matched: false, reasonCode: 'memo_missing' };
  }

  const matched = proof.memo === ctx.verificationToken;
  return {
    matched,
    reasonCode: matched ? 'identity_confirmed' : 'memo_mismatch',
  };
}

// ---------------------------------------------------------------------------
// Step 4 — Assemble final EvaluationResult
// ---------------------------------------------------------------------------

/**
 * Merge the three step results into one EvaluationResult.
 *
 * Priority (first failing check wins):
 *   1. Identity failure → unmatched
 *   2. Amount step forces a specific terminal decision → use it
 *   3. Meta (memo) failure → rejected
 *   4. Amount step suggests a named decision (overpaid / fee-match) → use it
 *   5. All clear → matched
 */
function buildEvalResult(
  identityStep: IdentityStepResult,
  amountStep: AmountStepResult,
  metaStep: MetaStepResult,
  expectedAmount: number,
): EvaluationResult {
  const observedAmount =
    amountStep.delta !== null ? expectedAmount + amountStep.delta : null;

  // ── 1. Identity failed ───────────────────────────────────────────────────
  if (!identityStep.matched) {
    const d: ResolutionDecision = 'unmatched';
    return {
      decision: d,
      reasonCode: identityStep.reasonCode,
      resolutionStatus: toResolutionStatus(d),
      confidenceScore: toConfidenceScore(d),
      identityMatched: false,
      amountMatched: false,
      metaMatched: false,
      observedAmount,
      expectedAmount,
      delta: amountStep.delta,
    };
  }

  // ── 2. Amount step forces a terminal failure ─────────────────────────────
  if (!amountStep.matched && amountStep.decision) {
    const d = amountStep.decision;
    return {
      decision: d,
      reasonCode: amountStep.reasonCode,
      resolutionStatus: toResolutionStatus(d),
      confidenceScore: toConfidenceScore(d),
      identityMatched: true,
      amountMatched: false,
      metaMatched: metaStep.matched,
      observedAmount,
      expectedAmount,
      delta: amountStep.delta,
    };
  }

  // ── 3. Meta (memo) check failed ──────────────────────────────────────────
  if (!metaStep.matched) {
    const d: ResolutionDecision = 'rejected';
    return {
      decision: d,
      reasonCode: metaStep.reasonCode,
      resolutionStatus: toResolutionStatus(d),
      confidenceScore: toConfidenceScore(d),
      identityMatched: true,
      amountMatched: amountStep.matched,
      metaMatched: false,
      observedAmount,
      expectedAmount,
      delta: amountStep.delta,
    };
  }

  // ── 4. Amount step suggests a named decision (overpaid / fee-match) ───────
  if (amountStep.decision) {
    const d = amountStep.decision;
    return {
      decision: d,
      reasonCode: amountStep.reasonCode,
      resolutionStatus: toResolutionStatus(d),
      confidenceScore: toConfidenceScore(d),
      identityMatched: true,
      amountMatched: amountStep.matched,
      metaMatched: true,
      observedAmount,
      expectedAmount,
      delta: amountStep.delta,
    };
  }

  // ── 5. All checks passed ─────────────────────────────────────────────────
  const d: ResolutionDecision = 'matched';
  return {
    decision: d,
    reasonCode: 'exact_amount',
    resolutionStatus: toResolutionStatus(d),
    confidenceScore: toConfidenceScore(d),
    identityMatched: true,
    amountMatched: true,
    metaMatched: true,
    observedAmount,
    expectedAmount,
    delta: amountStep.delta,
  };
}

// ---------------------------------------------------------------------------
// Public: pure evaluation function (no DB access)
// ---------------------------------------------------------------------------

/**
 * Evaluate a NormalizedProof against a loaded EvalContext.
 *
 * Pure function — no DB access, no side effects.  Exported for direct unit
 * testing and for callers that load context themselves.
 *
 * @param proof  Normalized proof from Phase 5 ingestion.
 * @param ctx    Pre-loaded context (identity, policy, intent fields).
 * @returns      EvaluationResult with decision, reasonCode, confidenceScore.
 */
export function evaluateProof(
  proof: NormalizedProof,
  ctx: EvalContext,
): EvaluationResult {
  // Early-exit guards for missing context
  if (!ctx.settlementIdentity && !ctx.policy) {
    const d: ResolutionDecision = 'rejected';
    return {
      decision: d,
      reasonCode: 'no_settlement_identity',
      resolutionStatus: toResolutionStatus(d),
      confidenceScore: toConfidenceScore(d),
      identityMatched: false,
      amountMatched: false,
      metaMatched: false,
      observedAmount: proof.grossAmount,
      expectedAmount: ctx.expectedAmountUsdc,
      delta: proof.grossAmount !== null
        ? proof.grossAmount - ctx.expectedAmountUsdc
        : null,
    };
  }

  if (!ctx.policy) {
    const d: ResolutionDecision = 'rejected';
    return {
      decision: d,
      reasonCode: 'no_matching_policy',
      resolutionStatus: toResolutionStatus(d),
      confidenceScore: toConfidenceScore(d),
      identityMatched: false,
      amountMatched: false,
      metaMatched: false,
      observedAmount: proof.grossAmount,
      expectedAmount: ctx.expectedAmountUsdc,
      delta: proof.grossAmount !== null
        ? proof.grossAmount - ctx.expectedAmountUsdc
        : null,
    };
  }

  const identityStep = stepIdentityMatch(proof, ctx);
  const amountStep   = stepAmountMatch(proof, ctx);
  const metaStep     = stepMetaMatch(proof, ctx);

  return buildEvalResult(identityStep, amountStep, metaStep, ctx.expectedAmountUsdc);
}

// ---------------------------------------------------------------------------
// DB helpers (private — used only by runResolutionEngine)
// ---------------------------------------------------------------------------

async function loadMatchingPolicy(
  protocol: SettlementProtocol,
): Promise<MatchingPolicyRecord | null> {
  const row = await prisma.matchingPolicy.findFirst({
    where: { protocol, isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (!row) return null;
  return {
    id: row.id,
    protocol: row.protocol as SettlementProtocol,
    matchStrategy: row.matchStrategy as MatchStrategy,
    requireMemoMatch: row.requireMemoMatch,
    confirmationDepth: row.confirmationDepth,
    ttlSeconds: row.ttlSeconds,
    isActive: row.isActive,
    allowedFeeSource: (row as { allowedFeeSource?: string | null }).allowedFeeSource ?? null,
    toleranceBps: (row as { toleranceBps?: number | null }).toleranceBps ?? null,
    version: (row as { version?: number }).version ?? 1,
    config: (row.config as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Update payment_intents.status when the engine closes an intent. */
async function updateIntentStatus(intentId: string, status: string): Promise<void> {
  try {
    await prisma.paymentIntent.update({
      where: { id: intentId },
      data: { status, updatedAt: new Date() },
    });
    logger.debug('[ResolutionEngine] intent status updated', { intentId, status });
  } catch (err: unknown) {
    // Non-fatal: the resolution record write is more important than the status
    // update, and the intent will be reconciled on the next polling cycle.
    logger.warn('[ResolutionEngine] could not update intent status', {
      intentId,
      status,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Public: orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full resolution engine for a single intent + normalized proof.
 *
 * Orchestration:
 *   0. Idempotency guard — return existing resolution if already written
 *   1. Load settlement identity from DB (or use pre-loaded ID)
 *   2. Load matching policy from DB
 *   3. evaluateProof() — pure; no DB
 *   4. resolveIntent() — write intent_resolutions row
 *   5. updateIntentStatus() — set payment_intents.status
 *   6. emitSettlementEvent() — fire-and-forget audit log
 *
 * @param params  RunEngineParams
 * @returns       EngineRunResult with resolution, evaluation, wasAlreadyResolved
 */
export async function runResolutionEngine(
  params: RunEngineParams,
): Promise<EngineRunResult> {
  const {
    intentId,
    proof,
    expectedAmountUsdc,
    merchantWallet,
    verificationToken,
    resolvedBy,
    settlementIdentityId: preloadedIdentityId,
  } = params;

  // ── Step 0: idempotency guard ─────────────────────────────────────────────
  const existingResolution = await getResolution(intentId);
  if (existingResolution) {
    logger.debug('[ResolutionEngine] already resolved — returning existing record', {
      intentId,
      resolutionId: existingResolution.id,
    });
    // Reconstruct a minimal EvaluationResult from the stored record so callers
    // always receive a consistent EngineRunResult shape.
    const evaluation: EvaluationResult = {
      decision:         existingResolution.decisionCode ?? 'matched',
      reasonCode:       existingResolution.reasonCode   ?? 'identity_confirmed',
      resolutionStatus: existingResolution.resolutionStatus,
      confidenceScore:  existingResolution.confidenceScore ?? 1.0,
      identityMatched:  true,
      amountMatched:    true,
      metaMatched:      true,
      observedAmount:   null,
      expectedAmount:   expectedAmountUsdc,
      delta:            null,
    };
    return { resolution: existingResolution, evaluation, wasAlreadyResolved: true };
  }

  // ── Steps 1 + 2: load identity + policy ──────────────────────────────────
  let identity: SettlementIdentityRecord | null = null;
  if (preloadedIdentityId) {
    identity = await getSettlementIdentityById(preloadedIdentityId);
  } else {
    identity = await getActiveByIntentAndProtocol(intentId, proof.protocol);
  }

  const policy = await loadMatchingPolicy(proof.protocol);

  // ── Step 3: evaluate (pure) ───────────────────────────────────────────────
  const ctx: EvalContext = {
    intentId,
    expectedAmountUsdc,
    merchantWallet,
    verificationToken,
    settlementIdentity: identity,
    policy,
  };

  const evaluation = evaluateProof(proof, ctx);

  // ── Step 4: write resolution record ──────────────────────────────────────
  const resolution = await resolveIntent({
    intentId,
    protocol: proof.protocol,
    resolvedBy,
    resolutionStatus: evaluation.resolutionStatus,
    settlementIdentityId: identity?.id,
    externalRef: proof.externalRef,
    confirmationDepth: typeof proof.rawPayload?.confirmationDepth === 'number'
      ? proof.rawPayload.confirmationDepth
      : undefined,
    payerRef: proof.sender ?? undefined,
    decisionCode: evaluation.decision,
    reasonCode: evaluation.reasonCode,
    confidenceScore: evaluation.confidenceScore,
    metadata: {
      identityMatched: evaluation.identityMatched,
      amountMatched:   evaluation.amountMatched,
      metaMatched:     evaluation.metaMatched,
      observedAmount:  evaluation.observedAmount,
      expectedAmount:  evaluation.expectedAmount,
      delta:           evaluation.delta,
      proofProtocol:   proof.protocol,
      proofType:       proof.proofType,
    },
  });

  // ── Step 5: update payment_intents.status ─────────────────────────────────
  await updateIntentStatus(intentId, toIntentStatus(evaluation.resolutionStatus));

  // ── Step 6: emit settlement event (fire-and-forget) ───────────────────────
  emitSettlementEvent({
    eventType: evaluation.resolutionStatus === 'confirmed'
      ? 'on_chain_confirmed'
      : 'policy_mismatch',
    protocol: proof.protocol,
    settlementIdentityId: identity?.id,
    intentId,
    externalRef: proof.externalRef,
    payload: {
      decision:        evaluation.decision,
      reasonCode:      evaluation.reasonCode,
      confidenceScore: evaluation.confidenceScore,
      delta:           evaluation.delta,
    },
  });

  logger.info('[ResolutionEngine] resolved', {
    intentId,
    decision:        evaluation.decision,
    reasonCode:      evaluation.reasonCode,
    resolutionStatus: evaluation.resolutionStatus,
    confidenceScore: evaluation.confidenceScore,
    delta:           evaluation.delta,
  });

  return { resolution, evaluation, wasAlreadyResolved: false };
}
