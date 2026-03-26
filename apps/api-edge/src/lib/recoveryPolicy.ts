import type { RecoveryBucket } from './bookingHealth';

type BookingMetadata = Record<string, unknown> | null | undefined;

export type RecoveryAction = 'none' | 'retry_dispatch' | 'escalate_manual';

export type RecoveryPolicyDecision = {
  action: RecoveryAction;
  reason: string;
  canAutoRun: boolean;
};

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

export function evaluateRecoveryPolicy(
  recoveryBucket: RecoveryBucket,
  metadata?: BookingMetadata,
): RecoveryPolicyDecision {
  const attemptCount = asNumber(metadata?.recoveryAttemptCount);
  const manualReviewRequired = metadata?.manualReviewRequired === true;

  if (manualReviewRequired) {
    return {
      action: 'none',
      reason: 'Manual review already required.',
      canAutoRun: false,
    };
  }

  if (recoveryBucket === 'ready_for_dispatch') {
    if (attemptCount >= 2) {
      return {
        action: 'escalate_manual',
        reason: 'Dispatch retries exhausted.',
        canAutoRun: true,
      };
    }
    return {
      action: 'retry_dispatch',
      reason: 'Payment confirmed but dispatch has not started.',
      canAutoRun: true,
    };
  }

  if (recoveryBucket === 'stuck_securing') {
    if (attemptCount >= 1) {
      return {
        action: 'escalate_manual',
        reason: 'Job remains stuck securing after retry.',
        canAutoRun: true,
      };
    }
    return {
      action: 'retry_dispatch',
      reason: 'Dispatch should be retried once before manual review.',
      canAutoRun: true,
    };
  }

  if (recoveryBucket === 'fulfilment_failed' || recoveryBucket === 'failed') {
    return {
      action: 'escalate_manual',
      reason: 'Terminal failure requires operator review.',
      canAutoRun: true,
    };
  }

  return {
    action: 'none',
    reason: 'No automated recovery action needed.',
    canAutoRun: false,
  };
}
