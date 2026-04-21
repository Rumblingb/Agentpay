import { deriveBookingHealth, type RecoveryBucket } from './bookingHealth';
import { deriveBookingState, type BookingState } from './bookingState';
import { evaluateRecoveryPolicy, type RecoveryAction } from './recoveryPolicy';

type BookingMetadata = Record<string, unknown> | null | undefined;

export type ConciergeExecutionStatus =
  | 'queued'
  | 'payment_pending'
  | 'fulfilment_pending'
  | 'confirmed'
  | 'failed'
  | 'rolled_back'
  | 'attention_required';

export type ConciergeExecutionSnapshot = {
  jobId: string;
  intentId: string;
  status: ConciergeExecutionStatus;
  bookingState: BookingState;
  recoveryBucket: RecoveryBucket;
  summary: string;
  shouldEscalate: boolean;
  recommendedAction: RecoveryAction;
  recoveryReason: string;
  manualReviewRequired: boolean;
  asyncExecution: boolean;
  pendingFulfilment: boolean;
  paymentConfirmed: boolean;
  fulfilmentFailed: boolean;
  retryCount: number;
  quoteExpiresAt: string | null;
  paymentConfirmedAt: string | null;
  dispatchStartedAt: string | null;
  dispatchStatus: string | null;
  dispatchAttemptCount: number;
  dispatchError: string | null;
  nextDispatchRetryAt: string | null;
  rerouteOfferActionLabel: string | null;
  updatedAt: string | null;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

export function deriveRerouteOfferActionLabel(metadata?: BookingMetadata): string | null {
  const explicit = asString(metadata?.rerouteOfferActionLabel);
  if (explicit) return explicit;

  const altDeparture = asString((metadata?.alternativeService as Record<string, unknown> | undefined)?.departureTime);
  if (altDeparture) return `Switch to ${altDeparture}`;

  if (asString(metadata?.rerouteOfferTranscript)) return 'Find alternatives';
  return null;
}

function toExecutionStatus(params: {
  bookingState: BookingState;
  metadata?: BookingMetadata;
  recommendedAction: RecoveryAction;
}): ConciergeExecutionStatus {
  const manualReviewRequired = params.metadata?.manualReviewRequired === true;

  if (params.bookingState === 'issued') return 'confirmed';
  if (params.bookingState === 'refunded') return 'rolled_back';
  if (manualReviewRequired || params.recommendedAction === 'escalate_manual') return 'attention_required';
  if (params.bookingState === 'failed') return 'failed';
  if (params.bookingState === 'payment_pending') return 'payment_pending';
  if (params.bookingState === 'payment_confirmed' || params.bookingState === 'securing') {
    return 'fulfilment_pending';
  }
  return 'queued';
}

export function buildConciergeExecutionSnapshot(params: {
  jobId: string;
  intentStatus: string;
  metadata?: BookingMetadata;
  updatedAt?: string | null;
}): ConciergeExecutionSnapshot {
  const metadata = params.metadata ?? {};
  const health = deriveBookingHealth(params.intentStatus, metadata);
  const policy = evaluateRecoveryPolicy(health.recoveryBucket, metadata);
  const bookingState = deriveBookingState(params.intentStatus, metadata);
  const paymentConfirmed = ['payment_confirmed', 'securing', 'issued'].includes(bookingState);

  return {
    jobId: params.jobId,
    intentId: params.jobId,
    status: toExecutionStatus({
      bookingState,
      metadata,
      recommendedAction: policy.action,
    }),
    bookingState,
    recoveryBucket: health.recoveryBucket,
    summary: health.summary,
    shouldEscalate: health.shouldEscalate,
    recommendedAction: policy.action,
    recoveryReason: policy.reason,
    manualReviewRequired: metadata.manualReviewRequired === true,
    asyncExecution: metadata.asyncExecution === true,
    pendingFulfilment: metadata.pendingFulfilment === true,
    paymentConfirmed,
    fulfilmentFailed: metadata.fulfilmentFailed === true,
    retryCount: asNumber(metadata.recoveryAttemptCount),
    quoteExpiresAt: asString(metadata.quoteExpiresAt) ?? asString(metadata.expiresAt),
    paymentConfirmedAt: asString(metadata.paymentConfirmedAt),
    dispatchStartedAt: asString(metadata.openclawDispatchedAt),
    dispatchStatus: asString(metadata.dispatchStatus),
    dispatchAttemptCount: asNumber(metadata.dispatchAttemptCount),
    dispatchError: asString(metadata.dispatchError) ?? asString(metadata.openclawError),
    nextDispatchRetryAt: asString(metadata.nextDispatchRetryAt),
    rerouteOfferActionLabel: deriveRerouteOfferActionLabel(metadata),
    updatedAt: params.updatedAt ?? null,
  };
}
