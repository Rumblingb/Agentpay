import { describe, expect, it } from 'vitest';

import { buildConciergeExecutionSnapshot } from '../src/lib/conciergeExecution';

describe('buildConciergeExecutionSnapshot', () => {
  it('surfaces retry-pending dispatches as fulfilment recovery', () => {
    const snapshot = buildConciergeExecutionSnapshot({
      jobId: 'job_retry',
      intentStatus: 'confirmed',
      metadata: {
        paymentConfirmed: true,
        paymentConfirmedAt: new Date().toISOString(),
        pendingFulfilment: true,
        dispatchStatus: 'retry_pending',
        dispatchAttemptCount: 1,
        nextDispatchRetryAt: '2026-04-15T00:15:00.000Z',
        openclawError: 'gateway timeout',
      },
      updatedAt: '2026-04-15T00:00:00.000Z',
    });

    expect(snapshot.status).toBe('fulfilment_pending');
    expect(snapshot.recoveryBucket).toBe('ready_for_dispatch');
    expect(snapshot.recommendedAction).toBe('retry_dispatch');
    expect(snapshot.dispatchStatus).toBe('retry_pending');
    expect(snapshot.dispatchAttemptCount).toBe(1);
    expect(snapshot.dispatchError).toBe('gateway timeout');
    expect(snapshot.nextDispatchRetryAt).toBe('2026-04-15T00:15:00.000Z');
  });

  it('surfaces terminal dispatch failures as attention required', () => {
    const snapshot = buildConciergeExecutionSnapshot({
      jobId: 'job_failed',
      intentStatus: 'confirmed',
      metadata: {
        paymentConfirmed: true,
        paymentConfirmedAt: new Date().toISOString(),
        pendingFulfilment: true,
        dispatchStatus: 'failed',
        dispatchAttemptCount: 2,
        openclawError: 'missing rail details',
      },
      updatedAt: '2026-04-15T00:00:00.000Z',
    });

    expect(snapshot.status).toBe('attention_required');
    expect(snapshot.recoveryBucket).toBe('failed');
    expect(snapshot.recommendedAction).toBe('escalate_manual');
    expect(snapshot.dispatchStatus).toBe('failed');
    expect(snapshot.dispatchError).toBe('missing rail details');
  });
});
