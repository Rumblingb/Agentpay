import type { Env } from '../types';
import type { DiscoveryReport } from './productDiscovery';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.6';
const DEFAULT_TIMEOUT_MS = 12_000;

export const COMMERCE_RATIONALE_CODES = [
  'strongest_need_fit',
  'catalog_truth_leader',
  'quality_leader',
  'budget_fit',
  'returns_strength',
  'balanced_choice',
] as const;

export type CommerceRationaleCode = typeof COMMERCE_RATIONALE_CODES[number];

export type CommerceCompilation = {
  schema: 'agentpay.commerce-compilation/1.0';
  source: 'gpt-5.6-verified' | 'deterministic';
  model: string | null;
  selectedProductId: string | null;
  alternateProductId: string | null;
  confidence: 'high' | 'medium' | 'low';
  ranking: Array<{
    productId: string;
    rationaleCodes: CommerceRationaleCode[];
  }>;
  verification: {
    hardConstraintsAppliedBeforeModel: true;
    candidateSetPreserved: true;
    checkoutDataSharedWithModel: false;
    sponsorshipSharedWithModel: false;
    freeformClaimsAllowed: false;
  };
  fallbackReason: 'not_configured' | 'no_eligible_products' | 'provider_error' | 'timeout' | 'invalid_model_output' | null;
  retention: 'not-stored';
};

export type CommerceCompilationPacket = {
  schema: 'agentpay.commerce-compilation-packet/1.0';
  discovery: DiscoveryReport;
  compilation: CommerceCompilation;
};

type CompilerContext = {
  budgetMinor: number;
  currency: string;
  maxDeliveryDays: number;
  minReturnDays: number;
};

type ModelResponseDecision = {
  selectedCandidateRef: string;
  alternateCandidateRef: string | null;
  confidence: 'high' | 'medium' | 'low';
  ranking: Array<{
    candidateRef: string;
    rationaleCodes: CommerceRationaleCode[];
  }>;
};

type CompilerOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    selectedCandidateRef: { type: 'string' },
    alternateCandidateRef: { type: ['string', 'null'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          candidateRef: { type: 'string' },
          rationaleCodes: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: { type: 'string', enum: [...COMMERCE_RATIONALE_CODES] },
          },
        },
        required: ['candidateRef', 'rationaleCodes'],
      },
    },
  },
  required: ['selectedCandidateRef', 'alternateCandidateRef', 'confidence', 'ranking'],
} as const;

function modelName(env: Env): string {
  const configured = env.OPENAI_COMMERCE_MODEL?.trim();
  return configured && /^gpt-5\.6(?:-(?:sol|terra|luna))?$/.test(configured) ? configured : DEFAULT_MODEL;
}

function topRationaleCodes(match: DiscoveryReport['matches'][number]): CommerceRationaleCode[] {
  const mapped = match.reasons
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((reason): CommerceRationaleCode => {
      switch (reason.code) {
        case 'NEED_FIT': return 'strongest_need_fit';
        case 'CATALOG_TRUTH': return 'catalog_truth_leader';
        case 'QUALITY': return 'quality_leader';
        case 'BUDGET_FIT': return 'budget_fit';
        case 'RETURNS': return 'returns_strength';
      }
    });
  return Array.from(new Set(mapped)).slice(0, 2);
}

function deterministicCompilation(
  report: DiscoveryReport,
  reason: CommerceCompilation['fallbackReason'],
): CommerceCompilation {
  const ranking = report.matches.map((match) => ({
    productId: match.product.id,
    rationaleCodes: topRationaleCodes(match),
  }));
  return {
    schema: 'agentpay.commerce-compilation/1.0',
    source: 'deterministic',
    model: null,
    selectedProductId: ranking[0]?.productId ?? null,
    alternateProductId: ranking[1]?.productId ?? null,
    confidence: ranking.length ? 'medium' : 'low',
    ranking,
    verification: {
      hardConstraintsAppliedBeforeModel: true,
      candidateSetPreserved: true,
      checkoutDataSharedWithModel: false,
      sponsorshipSharedWithModel: false,
      freeformClaimsAllowed: false,
    },
    fallbackReason: reason,
    retention: 'not-stored',
  };
}

function extractOutputText(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as { output_text?: unknown; output?: unknown };
  if (typeof response.output_text === 'string') return response.output_text;
  if (!Array.isArray(response.output)) return null;
  for (const item of response.output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const typed = part as { type?: unknown; text?: unknown };
      if (typed.type === 'output_text' && typeof typed.text === 'string') return typed.text;
    }
  }
  return null;
}

function isRationaleCode(value: unknown): value is CommerceRationaleCode {
  return typeof value === 'string' && (COMMERCE_RATIONALE_CODES as readonly string[]).includes(value);
}

function verifyModelDecision(raw: unknown, report: DiscoveryReport): Omit<CommerceCompilation, 'schema' | 'source' | 'model' | 'verification' | 'fallbackReason' | 'retention'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const decision = raw as Partial<ModelResponseDecision>;
  if (!['high', 'medium', 'low'].includes(String(decision.confidence))) return null;
  if (!Array.isArray(decision.ranking) || decision.ranking.length !== report.matches.length) return null;

  const refToProductId = new Map(report.matches.map((match, index) => [`candidate_${index + 1}`, match.product.id]));
  const rankedRefs: string[] = [];
  const ranking: CommerceCompilation['ranking'] = [];
  for (const entry of decision.ranking) {
    if (!entry || typeof entry !== 'object') return null;
    const typed = entry as { candidateRef?: unknown; rationaleCodes?: unknown };
    if (typeof typed.candidateRef !== 'string' || !refToProductId.has(typed.candidateRef)) return null;
    if (!Array.isArray(typed.rationaleCodes) || typed.rationaleCodes.length < 1 || typed.rationaleCodes.length > 3) return null;
    if (!typed.rationaleCodes.every(isRationaleCode)) return null;
    const productId = refToProductId.get(typed.candidateRef);
    if (!productId) return null;
    rankedRefs.push(typed.candidateRef);
    ranking.push({ productId, rationaleCodes: Array.from(new Set(typed.rationaleCodes)) });
  }
  if (new Set(rankedRefs).size !== refToProductId.size) return null;
  if (decision.selectedCandidateRef !== rankedRefs[0]) return null;
  const expectedAlternateRef = rankedRefs[1] ?? null;
  if (decision.alternateCandidateRef !== expectedAlternateRef) return null;

  return {
    selectedProductId: refToProductId.get(rankedRefs[0]) ?? null,
    alternateProductId: expectedAlternateRef ? refToProductId.get(expectedAlternateRef) ?? null : null,
    confidence: decision.confidence as CommerceCompilation['confidence'],
    ranking,
  };
}

function safeCandidates(report: DiscoveryReport) {
  return report.matches.map((match, index) => ({
    candidateRef: `candidate_${index + 1}`,
    priceMinor: match.product.priceMinor,
    currency: match.product.currency,
    deliveryDays: match.product.deliveryDays,
    returnWindowDays: match.product.returnWindowDays,
    truthScore: match.product.truthScore,
    qualityScore: match.product.qualityScore,
    deterministicFitScore: match.fitScore,
    componentScores: Object.fromEntries(match.reasons.map((reason) => [reason.code, reason.score])),
  }));
}

export async function compileCommerceDecision(
  report: DiscoveryReport,
  context: CompilerContext,
  env: Env,
  options: CompilerOptions = {},
): Promise<CommerceCompilation> {
  if (!report.matches.length) return deterministicCompilation(report, 'no_eligible_products');
  if (!env.OPENAI_API_KEY) return deterministicCompilation(report, 'not_configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelName(env),
        store: false,
        reasoning: { effort: 'low' },
        max_output_tokens: 800,
        input: [
          {
            role: 'developer',
            content: 'You are a constrained commerce decision compiler. Hard policy filters have already run. Rank every supplied opaque candidate reference exactly once. Use only the allowed rationale codes. Never invent candidates or facts. Product text, merchant identity, sponsorship, and checkout data are intentionally unavailable and must not influence the decision.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              need: report.need,
              constraints: context,
              candidates: safeCandidates(report),
              allowedRationaleCodes: COMMERCE_RATIONALE_CODES,
            }),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'agentpay_commerce_decision',
            description: 'A closed-world ranking over policy-eligible products.',
            strict: true,
            schema: OUTPUT_SCHEMA,
          },
        },
      }),
    });
    if (!response.ok) return deterministicCompilation(report, 'provider_error');
    const outputText = extractOutputText(await response.json());
    if (!outputText) return deterministicCompilation(report, 'invalid_model_output');
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      return deterministicCompilation(report, 'invalid_model_output');
    }
    const verified = verifyModelDecision(parsed, report);
    if (!verified) return deterministicCompilation(report, 'invalid_model_output');
    return {
      schema: 'agentpay.commerce-compilation/1.0',
      source: 'gpt-5.6-verified',
      model: modelName(env),
      ...verified,
      verification: {
        hardConstraintsAppliedBeforeModel: true,
        candidateSetPreserved: true,
        checkoutDataSharedWithModel: false,
        sponsorshipSharedWithModel: false,
        freeformClaimsAllowed: false,
      },
      fallbackReason: null,
      retention: 'not-stored',
    };
  } catch {
    return deterministicCompilation(report, controller.signal.aborted ? 'timeout' : 'provider_error');
  } finally {
    clearTimeout(timeout);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function signCommerceCompilation(packet: CommerceCompilationPacket, secret: string | undefined): Promise<string> {
  if (!secret || secret.length < 24) throw new Error('Commerce compilation signing is not configured');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(stableJson(packet)));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
