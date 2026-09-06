import { describe, expect, it } from '@jest/globals';
import {
  LAUNCH_DEFAULT_SPEND_LIMIT_USD,
  envMaxUsdFromMinor,
  resolveSpendCeiling,
  spendLimitFromOverride,
} from '../../apps/api-edge/src/lib/spendCeiling';

describe('resolveSpendCeiling', () => {
  it('applies the Launch default when no merchant limit is set', () => {
    const decision = resolveSpendCeiling({ amountUsd: 10, planCode: 'launch' });
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.ceiling.limitUsd).toBe(LAUNCH_DEFAULT_SPEND_LIMIT_USD);
    expect(decision.ceiling.source).toBe('plan');
  });

  it('rejects over-limit spend with a real API error code', () => {
    const decision = resolveSpendCeiling({
      amountUsd: 40,
      merchantLimitUsd: 25,
      planCode: 'launch',
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.code).toBe('SPEND_LIMIT_EXCEEDED');
    expect(decision.message).toMatch(/exceeds the spend limit of 25/);
  });

  it('honours a merchant-set ceiling below the plan default', () => {
    const decision = resolveSpendCeiling({
      amountUsd: 6,
      merchantLimitUsd: 5,
      planCode: 'builder',
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.ceiling.source).toBe('merchant');
    expect(decision.ceiling.limitUsd).toBe(5);
  });

  it('clamps to the env hard cap', () => {
    const decision = resolveSpendCeiling({
      amountUsd: 80,
      merchantLimitUsd: 500,
      planCode: 'builder',
      envMaxUsd: 50,
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.ceiling.source).toBe('env');
    expect(decision.ceiling.limitUsd).toBe(50);
  });
});

describe('spendLimit helpers', () => {
  it('reads spendLimitUsd from pricing override JSON', () => {
    expect(spendLimitFromOverride({ spendLimitUsd: 12 })).toBe(12);
    expect(spendLimitFromOverride('{"spendLimitUsd":15}')).toBe(15);
    expect(spendLimitFromOverride(null)).toBeNull();
  });

  it('converts AGENTPAY_MAX_PAYMENT_MINOR to USD', () => {
    expect(envMaxUsdFromMinor('10000')).toBe(100);
    expect(envMaxUsdFromMinor(undefined)).toBeNull();
  });
});
