import { describe, expect, it } from 'vitest';
import {
  digestExecutionApprovalPayload,
  executionApprovalClaimDecision,
  stableCanonicalJson,
  type ExecutionApprovalPayload,
} from '../src/lib/executionApprovals';

function payload(overrides: Partial<ExecutionApprovalPayload> = {}): ExecutionApprovalPayload {
  return {
    schema: 'agentpay.execution-approval/1.0',
    actionKind: 'ace_travel',
    principalId: 'agt_test_traveller',
    transcript: 'Book the second hotel in Paris',
    plan: [{ toolName: 'book_hotel', estimatedPriceUsdc: 210, input: { selected_hotel: 'Hotel B' } }],
    amountMinor: 21000,
    currency: 'GBP',
    createdAt: '2026-07-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('execution approval canonical binding', () => {
  it('is stable across object key insertion order', async () => {
    const first = payload();
    const reordered = {
      createdAt: first.createdAt,
      currency: first.currency,
      amountMinor: first.amountMinor,
      plan: first.plan,
      transcript: first.transcript,
      principalId: first.principalId,
      actionKind: first.actionKind,
      schema: first.schema,
    } as ExecutionApprovalPayload;

    expect(stableCanonicalJson(reordered)).toBe(stableCanonicalJson(first));
    await expect(digestExecutionApprovalPayload(reordered)).resolves.toBe(
      await digestExecutionApprovalPayload(first),
    );
  });

  it('changes when the selected option is tampered with', async () => {
    const original = payload();
    const tampered = payload({
      plan: [{ toolName: 'book_hotel', estimatedPriceUsdc: 210, input: { selected_hotel: 'Hotel C' } }],
    });

    await expect(digestExecutionApprovalPayload(tampered)).resolves.not.toBe(
      await digestExecutionApprovalPayload(original),
    );
  });

  it('changes when the amount, currency, principal, or action kind changes', async () => {
    const originalDigest = await digestExecutionApprovalPayload(payload());
    const variants = [
      payload({ amountMinor: 21001 }),
      payload({ currency: 'EUR' }),
      payload({ principalId: 'agt_other_traveller' }),
      payload({ actionKind: 'commerce_checkout' }),
    ];

    for (const variant of variants) {
      await expect(digestExecutionApprovalPayload(variant)).resolves.not.toBe(originalDigest);
    }
  });

  it('preserves array order so option and leg order cannot be swapped', async () => {
    const original = payload({
      plan: [
        { toolName: 'book_train', input: { origin: 'London', destination: 'Paris' } },
        { toolName: 'book_hotel', input: { selected_hotel: 'Hotel B' } },
      ],
    });
    const swapped = payload({ plan: [...original.plan].reverse() });

    await expect(digestExecutionApprovalPayload(swapped)).resolves.not.toBe(
      await digestExecutionApprovalPayload(original),
    );
  });
});

describe('execution approval one-time state', () => {
  it('claims only approved, unused sessions', () => {
    expect(executionApprovalClaimDecision('approved', null)).toBe('claim');
  });

  it('returns the cached result for a completed retry', () => {
    expect(executionApprovalClaimDecision('completed', new Date())).toBe('replay');
  });

  it.each<[string, Date | null, string]>([
    ['executing', null, 'EXECUTION_APPROVAL_IN_PROGRESS'],
    ['approved', new Date(), 'EXECUTION_APPROVAL_IN_PROGRESS'],
    ['failed', null, 'EXECUTION_APPROVAL_FAILED'],
    ['pending', null, 'EXECUTION_APPROVAL_NOT_CONFIRMED'],
  ])('rejects status %s with the expected code', (status, consumedAt, code) => {
    expect(() => executionApprovalClaimDecision(status, consumedAt)).toThrow(code);
  });
});
