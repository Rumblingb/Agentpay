export type PreferenceWeights = {
  price: number;
  quality: number;
  delivery: number;
  sustainability: number;
};

export type BuyerConstitution = {
  currency: string;
  maxTotalMinor: number;
  allowedCategories?: string[];
  allowedMerchants?: string[];
  blockedMerchants?: string[];
  requiresRefundable?: boolean;
  minimumReturnWindowDays?: number;
  maximumDeliveryDays?: number;
  maxEvidenceAgeMinutes?: number;
  requireHumanApproval?: boolean;
  autoApproveBelowMinor?: number;
  weights?: Partial<PreferenceWeights>;
};

export type CommerceEvidence = {
  field: string;
  value: string;
  source: string;
  observedAt: string;
};

export type CommerceCandidate = {
  id: string;
  name: string;
  merchantId: string;
  merchantName: string;
  category: string;
  priceMinor: number;
  currency: string;
  refundable: boolean;
  returnWindowDays: number;
  deliveryDays: number;
  qualityScore?: number;
  sustainabilityScore?: number;
  evidence: CommerceEvidence[];
};

export type CommerceDecisionInput = {
  procurementRequestId?: string;
  intent: string;
  constitution: BuyerConstitution;
  candidates: CommerceCandidate[];
};

export type DecisionReason = {
  code: string;
  message: string;
};

type EvaluatedCandidate = CommerceCandidate & {
  score: number;
  factors: PreferenceWeights;
  evidenceFreshAt: string;
};

export type CommerceDecision = {
  schema: 'agentpay.commerce-choice-receipt/1.0';
  decisionId: string;
  procurementRequestId?: string;
  generatedAt: string;
  expiresAt: string;
  intent: string;
  constitution: BuyerConstitution & { weights: PreferenceWeights };
  recommendation: EvaluatedCandidate | null;
  eligible: EvaluatedCandidate[];
  rejected: Array<{
    candidate: CommerceCandidate;
    reasons: DecisionReason[];
  }>;
  tradeoffs: string[];
  approval: {
    required: boolean;
    mode: 'human' | 'policy-auto' | 'unavailable';
    reason: string;
  };
  proposedMandate: null | {
    decisionId: string;
    merchantId: string;
    candidateId: string;
    amountMinor: number;
    currency: string;
    oneTime: true;
    expiresAt: string;
  };
  retention: 'not-stored';
};

const DEFAULT_WEIGHTS: PreferenceWeights = {
  price: 35,
  quality: 30,
  delivery: 20,
  sustainability: 15,
};

const MAX_CANDIDATES = 50;
const MAX_EVIDENCE_PER_CANDIDATE = 20;
const DEFAULT_MAX_EVIDENCE_AGE_MINUTES = 24 * 60;

export class CommerceDecisionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommerceDecisionError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertString(value: unknown, field: string, maxLength = 500): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new CommerceDecisionError('INVALID_REQUEST', `${field} must be a non-empty string of at most ${maxLength} characters`);
  }
}

function assertInteger(value: unknown, field: string, min: number, max: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new CommerceDecisionError('INVALID_REQUEST', `${field} must be an integer between ${min} and ${max}`);
  }
}

function assertScore(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new CommerceDecisionError('INVALID_REQUEST', `${field} must be between 0 and 100`);
  }
}

function normalizeStringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) {
    throw new CommerceDecisionError('INVALID_REQUEST', `${field} must be an array with at most 100 values`);
  }
  const normalized = value.map((item, index) => {
    assertString(item, `${field}[${index}]`, 120);
    return item.trim().toLowerCase();
  });
  return [...new Set(normalized)];
}

function normalizeWeights(value: unknown): PreferenceWeights {
  if (value === undefined) return { ...DEFAULT_WEIGHTS };
  if (!isRecord(value)) {
    throw new CommerceDecisionError('INVALID_REQUEST', 'constitution.weights must be an object');
  }
  const raw: PreferenceWeights = {
    price: value.price === undefined ? DEFAULT_WEIGHTS.price : value.price as number,
    quality: value.quality === undefined ? DEFAULT_WEIGHTS.quality : value.quality as number,
    delivery: value.delivery === undefined ? DEFAULT_WEIGHTS.delivery : value.delivery as number,
    sustainability: value.sustainability === undefined
      ? DEFAULT_WEIGHTS.sustainability
      : value.sustainability as number,
  };
  for (const [field, score] of Object.entries(raw)) assertScore(score, `constitution.weights.${field}`);
  const total = Object.values(raw).reduce((sum, score) => sum + score, 0);
  if (total === 0) throw new CommerceDecisionError('INVALID_REQUEST', 'At least one preference weight must be greater than zero');
  return Object.fromEntries(
    Object.entries(raw).map(([field, score]) => [field, Number(((score / total) * 100).toFixed(4))]),
  ) as PreferenceWeights;
}

export function normalizeBuyerConstitution(raw: unknown): BuyerConstitution & { weights: PreferenceWeights } {
  if (!isRecord(raw)) throw new CommerceDecisionError('INVALID_REQUEST', 'constitution must be an object');
  assertString(raw.currency, 'constitution.currency', 3);
  const currency = raw.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new CommerceDecisionError('INVALID_REQUEST', 'constitution.currency must be a three-letter currency code');
  }
  assertInteger(raw.maxTotalMinor, 'constitution.maxTotalMinor', 1, 100_000_000_000);

  const integerFields: Array<[string, number, number]> = [
    ['minimumReturnWindowDays', 0, 3650],
    ['maximumDeliveryDays', 0, 3650],
    ['maxEvidenceAgeMinutes', 1, 525_600],
    ['autoApproveBelowMinor', 1, raw.maxTotalMinor],
  ];
  for (const [field, min, max] of integerFields) {
    if (raw[field] !== undefined) assertInteger(raw[field], `constitution.${field}`, min, max);
  }
  for (const field of ['requiresRefundable', 'requireHumanApproval']) {
    if (raw[field] !== undefined && typeof raw[field] !== 'boolean') {
      throw new CommerceDecisionError('INVALID_REQUEST', `constitution.${field} must be a boolean`);
    }
  }

  return {
    currency,
    maxTotalMinor: raw.maxTotalMinor,
    allowedCategories: normalizeStringList(raw.allowedCategories, 'constitution.allowedCategories'),
    allowedMerchants: normalizeStringList(raw.allowedMerchants, 'constitution.allowedMerchants'),
    blockedMerchants: normalizeStringList(raw.blockedMerchants, 'constitution.blockedMerchants'),
    requiresRefundable: raw.requiresRefundable === true,
    minimumReturnWindowDays: raw.minimumReturnWindowDays as number | undefined,
    maximumDeliveryDays: raw.maximumDeliveryDays as number | undefined,
    maxEvidenceAgeMinutes: (raw.maxEvidenceAgeMinutes as number | undefined) ?? DEFAULT_MAX_EVIDENCE_AGE_MINUTES,
    requireHumanApproval: raw.requireHumanApproval !== false,
    autoApproveBelowMinor: raw.autoApproveBelowMinor as number | undefined,
    weights: normalizeWeights(raw.weights),
  };
}

function normalizeEvidence(raw: unknown, candidateIndex: number, evidenceIndex: number): CommerceEvidence {
  if (!isRecord(raw)) throw new CommerceDecisionError('INVALID_REQUEST', `candidates[${candidateIndex}].evidence[${evidenceIndex}] must be an object`);
  const prefix = `candidates[${candidateIndex}].evidence[${evidenceIndex}]`;
  assertString(raw.field, `${prefix}.field`, 120);
  assertString(raw.value, `${prefix}.value`, 500);
  assertString(raw.source, `${prefix}.source`, 1024);
  assertString(raw.observedAt, `${prefix}.observedAt`, 40);
  let source: URL;
  try {
    source = new URL(raw.source);
  } catch {
    throw new CommerceDecisionError('INVALID_REQUEST', `${prefix}.source must be a valid HTTPS URL`);
  }
  if (source.protocol !== 'https:') {
    throw new CommerceDecisionError('INVALID_REQUEST', `${prefix}.source must use HTTPS`);
  }
  const observedAt = new Date(raw.observedAt);
  if (Number.isNaN(observedAt.getTime())) {
    throw new CommerceDecisionError('INVALID_REQUEST', `${prefix}.observedAt must be an ISO timestamp`);
  }
  return {
    field: raw.field.trim(),
    value: raw.value.trim(),
    source: source.toString(),
    observedAt: observedAt.toISOString(),
  };
}

function normalizeCandidate(raw: unknown, index: number): CommerceCandidate {
  if (!isRecord(raw)) throw new CommerceDecisionError('INVALID_REQUEST', `candidates[${index}] must be an object`);
  const id = raw.id;
  const name = raw.name;
  const merchantId = raw.merchantId;
  const merchantName = raw.merchantName;
  const category = raw.category;
  const currency = raw.currency;
  assertString(id, `candidates[${index}].id`, 120);
  assertString(name, `candidates[${index}].name`, 240);
  assertString(merchantId, `candidates[${index}].merchantId`, 120);
  assertString(merchantName, `candidates[${index}].merchantName`, 120);
  assertString(category, `candidates[${index}].category`, 120);
  assertString(currency, `candidates[${index}].currency`, 3);
  assertInteger(raw.priceMinor, `candidates[${index}].priceMinor`, 0, 100_000_000_000);
  assertInteger(raw.returnWindowDays, `candidates[${index}].returnWindowDays`, 0, 3650);
  assertInteger(raw.deliveryDays, `candidates[${index}].deliveryDays`, 0, 3650);
  if (typeof raw.refundable !== 'boolean') {
    throw new CommerceDecisionError('INVALID_REQUEST', `candidates[${index}].refundable must be a boolean`);
  }
  if (raw.qualityScore !== undefined) assertScore(raw.qualityScore, `candidates[${index}].qualityScore`);
  if (raw.sustainabilityScore !== undefined) assertScore(raw.sustainabilityScore, `candidates[${index}].sustainabilityScore`);
  if (!Array.isArray(raw.evidence) || raw.evidence.length === 0 || raw.evidence.length > MAX_EVIDENCE_PER_CANDIDATE) {
    throw new CommerceDecisionError('INVALID_REQUEST', `candidates[${index}].evidence must contain 1-${MAX_EVIDENCE_PER_CANDIDATE} entries`);
  }
  return {
    id: id.trim(),
    name: name.trim(),
    merchantId: merchantId.trim(),
    merchantName: merchantName.trim(),
    category: category.trim().toLowerCase(),
    priceMinor: raw.priceMinor,
    currency: currency.trim().toUpperCase(),
    refundable: raw.refundable,
    returnWindowDays: raw.returnWindowDays,
    deliveryDays: raw.deliveryDays,
    qualityScore: raw.qualityScore as number | undefined,
    sustainabilityScore: raw.sustainabilityScore as number | undefined,
    evidence: raw.evidence.map((entry, evidenceIndex) => normalizeEvidence(entry, index, evidenceIndex)),
  };
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => item === undefined ? 'null' : canonicalize(item)).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hashCommerceValue(value: unknown): Promise<string> {
  return sha256(canonicalize(value));
}

function reason(code: string, message: string): DecisionReason {
  return { code, message };
}

function rejectionReasons(
  candidate: CommerceCandidate,
  constitution: BuyerConstitution & { weights: PreferenceWeights },
  now: Date,
): DecisionReason[] {
  const reasons: DecisionReason[] = [];
  const merchant = candidate.merchantId.toLowerCase();
  if (candidate.currency !== constitution.currency) reasons.push(reason('CURRENCY_MISMATCH', `Requires ${constitution.currency}, candidate uses ${candidate.currency}`));
  if (candidate.priceMinor > constitution.maxTotalMinor) reasons.push(reason('OVER_BUDGET', 'Candidate exceeds the hard purchase ceiling'));
  if (constitution.allowedCategories?.length && !constitution.allowedCategories.includes(candidate.category)) reasons.push(reason('CATEGORY_NOT_ALLOWED', 'Candidate category is outside the buyer constitution'));
  if (constitution.allowedMerchants?.length && !constitution.allowedMerchants.includes(merchant)) reasons.push(reason('MERCHANT_NOT_ALLOWED', 'Merchant is not on the allowlist'));
  if (constitution.blockedMerchants?.includes(merchant)) reasons.push(reason('MERCHANT_BLOCKED', 'Merchant is explicitly blocked'));
  if (constitution.requiresRefundable && !candidate.refundable) reasons.push(reason('NOT_REFUNDABLE', 'Buyer constitution requires a refundable purchase'));
  if (constitution.minimumReturnWindowDays !== undefined && candidate.returnWindowDays < constitution.minimumReturnWindowDays) reasons.push(reason('RETURN_WINDOW_TOO_SHORT', `Return window is shorter than ${constitution.minimumReturnWindowDays} days`));
  if (constitution.maximumDeliveryDays !== undefined && candidate.deliveryDays > constitution.maximumDeliveryDays) reasons.push(reason('DELIVERY_TOO_SLOW', `Delivery exceeds ${constitution.maximumDeliveryDays} days`));

  const maxAgeMs = (constitution.maxEvidenceAgeMinutes ?? DEFAULT_MAX_EVIDENCE_AGE_MINUTES) * 60_000;
  const freshEvidence = candidate.evidence.filter((entry) => {
    const ageMs = now.getTime() - new Date(entry.observedAt).getTime();
    return ageMs >= -5 * 60_000 && ageMs <= maxAgeMs;
  });
  if (freshEvidence.length === 0) reasons.push(reason('EVIDENCE_STALE', 'No evidence is fresh enough for this decision'));
  return reasons;
}

function scoreCandidate(
  candidate: CommerceCandidate,
  constitution: BuyerConstitution & { weights: PreferenceWeights },
): Omit<EvaluatedCandidate, keyof CommerceCandidate | 'evidenceFreshAt'> {
  const deliveryCeiling = Math.max(constitution.maximumDeliveryDays ?? 30, 1);
  const factors: PreferenceWeights = {
    price: Number((Math.max(0, 1 - candidate.priceMinor / constitution.maxTotalMinor) * 100).toFixed(2)),
    quality: candidate.qualityScore ?? 50,
    delivery: Number((Math.max(0, 1 - candidate.deliveryDays / deliveryCeiling) * 100).toFixed(2)),
    sustainability: candidate.sustainabilityScore ?? 50,
  };
  const weighted = Object.entries(factors).reduce(
    (total, [field, value]) => total + value * constitution.weights[field as keyof PreferenceWeights],
    0,
  ) / 100;
  return { score: Number(weighted.toFixed(2)), factors };
}

function buildTradeoffs(eligible: EvaluatedCandidate[]): string[] {
  if (!eligible.length) return ['No candidate satisfies every hard constraint.'];
  const winner = eligible[0];
  const cheapest = [...eligible].sort((a, b) => a.priceMinor - b.priceMinor)[0];
  const fastest = [...eligible].sort((a, b) => a.deliveryDays - b.deliveryDays)[0];
  const longestReturns = [...eligible].sort((a, b) => b.returnWindowDays - a.returnWindowDays)[0];
  const tradeoffs: string[] = [];
  if (winner.id !== cheapest.id) tradeoffs.push(`Costs ${winner.priceMinor - cheapest.priceMinor} minor units more than the cheapest eligible option.`);
  if (winner.id !== fastest.id) tradeoffs.push(`Arrives ${winner.deliveryDays - fastest.deliveryDays} day(s) later than the fastest eligible option.`);
  if (winner.id !== longestReturns.id) tradeoffs.push(`Has a ${longestReturns.returnWindowDays - winner.returnWindowDays}-day shorter return window than the most flexible eligible option.`);
  if (!tradeoffs.length) tradeoffs.push('The recommendation does not lose on price, delivery, or return-window flexibility among eligible candidates.');
  return tradeoffs;
}

export async function evaluateCommerceDecision(raw: unknown, now = new Date()): Promise<CommerceDecision> {
  if (!isRecord(raw)) throw new CommerceDecisionError('INVALID_REQUEST', 'Request body must be an object');
  assertString(raw.intent, 'intent', 1000);
  if (raw.procurementRequestId !== undefined) {
    assertString(raw.procurementRequestId, 'procurementRequestId', 128);
  }
  if (!Array.isArray(raw.candidates) || raw.candidates.length === 0 || raw.candidates.length > MAX_CANDIDATES) {
    throw new CommerceDecisionError('INVALID_REQUEST', `candidates must contain 1-${MAX_CANDIDATES} entries`);
  }
  const constitution = normalizeBuyerConstitution(raw.constitution);
  const candidates = raw.candidates.map(normalizeCandidate);
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) {
    throw new CommerceDecisionError('INVALID_REQUEST', 'Candidate IDs must be unique');
  }

  const rejected: CommerceDecision['rejected'] = [];
  const eligible: EvaluatedCandidate[] = [];
  for (const candidate of candidates) {
    const reasons = rejectionReasons(candidate, constitution, now);
    if (reasons.length) {
      rejected.push({ candidate, reasons });
      continue;
    }
    const freshest = [...candidate.evidence]
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0].observedAt;
    eligible.push({ ...candidate, ...scoreCandidate(candidate, constitution), evidenceFreshAt: freshest });
  }
  eligible.sort((a, b) => b.score - a.score || a.priceMinor - b.priceMinor || a.id.localeCompare(b.id));

  const procurementRequestId = raw.procurementRequestId?.trim();
  const normalizedInput = { procurementRequestId, intent: raw.intent.trim(), constitution, candidates };
  const decisionId = `decision_${(await sha256(canonicalize(normalizedInput))).slice(0, 32)}`;
  const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  const recommendation = eligible[0] ?? null;
  const approvalRequired = Boolean(recommendation) && (
    constitution.requireHumanApproval !== false
    || constitution.autoApproveBelowMinor === undefined
    || recommendation.priceMinor > constitution.autoApproveBelowMinor
  );

  return {
    schema: 'agentpay.commerce-choice-receipt/1.0',
    decisionId,
    ...(procurementRequestId ? { procurementRequestId } : {}),
    generatedAt: now.toISOString(),
    expiresAt,
    intent: raw.intent.trim(),
    constitution,
    recommendation,
    eligible,
    rejected,
    tradeoffs: buildTradeoffs(eligible),
    approval: recommendation ? {
      required: approvalRequired,
      mode: approvalRequired ? 'human' : 'policy-auto',
      reason: approvalRequired
        ? 'The buyer constitution requires explicit approval for this purchase.'
        : 'The recommendation is inside the configured auto-approval ceiling.',
    } : {
      required: false,
      mode: 'unavailable',
      reason: 'No candidate satisfies every hard constraint.',
    },
    proposedMandate: recommendation ? {
      decisionId,
      merchantId: recommendation.merchantId,
      candidateId: recommendation.id,
      amountMinor: recommendation.priceMinor,
      currency: recommendation.currency,
      oneTime: true,
      expiresAt,
    } : null,
    retention: 'not-stored',
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function signCommerceDecision(decision: CommerceDecision, secret: string): Promise<string> {
  if (secret.length < 32) throw new CommerceDecisionError('SIGNING_UNAVAILABLE', 'Decision signing is not configured');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonicalize(decision)));
  return base64Url(new Uint8Array(signature));
}

export async function verifyCommerceDecisionSignature(
  decision: CommerceDecision,
  signature: string,
  secret: string,
): Promise<boolean> {
  const expected = await signCommerceDecision(decision, secret);
  if (signature.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < signature.length; index += 1) {
    difference |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}
