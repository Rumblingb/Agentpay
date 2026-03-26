import { evaluateRecoveryPolicy } from '../../apps/api-edge/src/lib/recoveryPolicy';

describe('evaluateRecoveryPolicy', () => {
  it('retries dispatch for ready_for_dispatch before retry budget is exhausted', () => {
    const result = evaluateRecoveryPolicy('ready_for_dispatch', { recoveryAttemptCount: 1 });

    expect(result.action).toBe('retry_dispatch');
    expect(result.canAutoRun).toBe(true);
  });

  it('escalates manual review when ready_for_dispatch retries are exhausted', () => {
    const result = evaluateRecoveryPolicy('ready_for_dispatch', { recoveryAttemptCount: 2 });

    expect(result.action).toBe('escalate_manual');
    expect(result.canAutoRun).toBe(true);
  });

  it('stops automation once manual review is already required', () => {
    const result = evaluateRecoveryPolicy('failed', { manualReviewRequired: true });

    expect(result.action).toBe('none');
    expect(result.canAutoRun).toBe(false);
  });
});
