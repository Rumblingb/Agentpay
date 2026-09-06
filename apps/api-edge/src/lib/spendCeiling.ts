/**
 * Server-side spend ceiling for Launch/Builder keys.
 *
 * Product promise: one key, you set the limit. The limit is enforced here,
 * not in client copy. Launch and Builder always have a ceiling.
 */

import type { HostedMcpPlanCode } from './mcpBilling';
import { normalizeHostedMcpPlanCode } from './mcpBilling';

export const LAUNCH_DEFAULT_SPEND_LIMIT_USD = 25;
export const BUILDER_DEFAULT_SPEND_LIMIT_USD = 250;
export const GROWTH_DEFAULT_SPEND_LIMIT_USD = 1_000;
export const ENTERPRISE_DEFAULT_SPEND_LIMIT_USD = 10_000;

export type SpendCeilingSource = 'merchant' | 'plan' | 'env';

export type SpendCeiling = {
  limitUsd: number;
  source: SpendCeilingSource;
  planCode: HostedMcpPlanCode;
};

export type SpendCeilingDecision =
  | { allowed: true; ceiling: SpendCeiling }
  | {
      allowed: false;
      code: 'SPEND_LIMIT_EXCEEDED';
      ceiling: SpendCeiling;
      amountUsd: number;
      message: string;
    };

export function defaultSpendLimitUsdForPlan(planCode: HostedMcpPlanCode): number {
  switch (planCode) {
    case 'launch':
      return LAUNCH_DEFAULT_SPEND_LIMIT_USD;
    case 'builder':
      return BUILDER_DEFAULT_SPEND_LIMIT_USD;
    case 'growth':
      return GROWTH_DEFAULT_SPEND_LIMIT_USD;
    case 'enterprise':
      return ENTERPRISE_DEFAULT_SPEND_LIMIT_USD;
    default: {
      const _exhaustive: never = planCode;
      return _exhaustive;
    }
  }
}

export function parseSpendLimitUsd(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function parsePricingOverride(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function resolveSpendCeiling(input: {
  amountUsd: number;
  merchantLimitUsd?: number | null;
  planCode?: unknown;
  envMaxUsd?: number | null;
}): SpendCeilingDecision {
  const planCode = normalizeHostedMcpPlanCode(input.planCode);
  const planLimit = defaultSpendLimitUsdForPlan(planCode);
  const merchantLimit = parseSpendLimitUsd(input.merchantLimitUsd);
  const envMax = parseSpendLimitUsd(input.envMaxUsd);

  let limitUsd = merchantLimit ?? planLimit;
  let source: SpendCeilingSource = merchantLimit !== null ? 'merchant' : 'plan';

  if (envMax !== null && envMax < limitUsd) {
    limitUsd = envMax;
    source = 'env';
  }

  const ceiling: SpendCeiling = { limitUsd, source, planCode };
  if (input.amountUsd > limitUsd) {
    return {
      allowed: false,
      code: 'SPEND_LIMIT_EXCEEDED',
      ceiling,
      amountUsd: input.amountUsd,
      message: `Payment of ${input.amountUsd} exceeds the spend limit of ${limitUsd} USD. Raise the limit on this key or send a smaller amount.`,
    };
  }
  return { allowed: true, ceiling };
}

export function envMaxUsdFromMinor(maxPaymentMinor?: string | null): number | null {
  if (!maxPaymentMinor) return null;
  const minor = Number(maxPaymentMinor);
  if (!Number.isFinite(minor) || minor <= 0) return null;
  return minor / 100;
}

export function spendLimitFromOverride(override: unknown): number | null {
  const parsed = parsePricingOverride(override);
  return parseSpendLimitUsd(parsed.spendLimitUsd);
}

export function mergeSpendLimitOverride(
  existing: unknown,
  spendLimitUsd: number,
): Record<string, unknown> {
  return {
    ...parsePricingOverride(existing),
    spendLimitUsd,
  };
}
