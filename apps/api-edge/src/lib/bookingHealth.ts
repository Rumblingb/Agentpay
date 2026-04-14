import { deriveBookingState, type BookingState } from './bookingState';

export type RecoveryBucket =
  | 'healthy'
  | 'awaiting_payment'
  | 'ready_for_dispatch'
  | 'stuck_securing'
  | 'fulfilment_failed'
  | 'issued'
  | 'refunded'
  | 'failed';

export type BookingHealth = {
  bookingState: BookingState;
  recoveryBucket: RecoveryBucket;
  shouldEscalate: boolean;
  summary: string;
};

type BookingMetadata = Record<string, unknown> | null | undefined;

function minutesSince(value?: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.round((Date.now() - ms) / 60_000);
}

export function deriveBookingHealth(intentStatus: string, metadata?: BookingMetadata): BookingHealth {
  const bookingState = deriveBookingState(intentStatus, metadata);
  const paymentConfirmedMins = minutesSince((metadata?.paymentConfirmedAt as string | undefined) ?? null);
  const dispatchedMins = minutesSince((metadata?.openclawDispatchedAt as string | undefined) ?? null);
  const fulfilmentFailed = metadata?.fulfilmentFailed === true;
  const dispatchStatus = typeof metadata?.dispatchStatus === 'string' ? metadata.dispatchStatus : null;

  if (bookingState === 'issued') {
    return { bookingState, recoveryBucket: 'issued', shouldEscalate: false, summary: 'Booking issued.' };
  }
  if (bookingState === 'refunded') {
    return { bookingState, recoveryBucket: 'refunded', shouldEscalate: false, summary: 'Booking refunded.' };
  }
  if (bookingState === 'failed' && fulfilmentFailed) {
    return { bookingState, recoveryBucket: 'fulfilment_failed', shouldEscalate: true, summary: 'Fulfilment failed and needs intervention.' };
  }
  if (bookingState === 'failed') {
    return { bookingState, recoveryBucket: 'failed', shouldEscalate: true, summary: 'Booking failed and needs review.' };
  }
  if (bookingState === 'payment_pending') {
    return { bookingState, recoveryBucket: 'awaiting_payment', shouldEscalate: false, summary: 'Awaiting payment confirmation.' };
  }
  if (bookingState === 'payment_confirmed') {
    if (dispatchStatus === 'retry_pending') {
      return {
        bookingState,
        recoveryBucket: 'ready_for_dispatch',
        shouldEscalate: false,
        summary: 'The booking handoff needs a retry. Ace has queued another dispatch attempt.',
      };
    }
    if (dispatchStatus === 'failed') {
      return {
        bookingState,
        recoveryBucket: 'failed',
        shouldEscalate: true,
        summary: 'The booking handoff failed and needs intervention.',
      };
    }
    const stale = paymentConfirmedMins != null && paymentConfirmedMins >= 10;
    return {
      bookingState,
      recoveryBucket: stale ? 'ready_for_dispatch' : 'healthy',
      shouldEscalate: stale,
      summary: stale ? 'Payment confirmed but dispatch has not started.' : 'Payment confirmed; dispatch window still open.',
    };
  }
  if (bookingState === 'securing') {
    if (dispatchStatus === 'retry_pending') {
      return {
        bookingState,
        recoveryBucket: 'ready_for_dispatch',
        shouldEscalate: false,
        summary: 'The booking handoff needs a retry. Ace has queued another dispatch attempt.',
      };
    }
    if (dispatchStatus === 'failed') {
      return {
        bookingState,
        recoveryBucket: 'failed',
        shouldEscalate: true,
        summary: 'The booking handoff failed and needs intervention.',
      };
    }
    const stale = dispatchedMins != null ? dispatchedMins >= 15 : paymentConfirmedMins != null && paymentConfirmedMins >= 20;
    return {
      bookingState,
      recoveryBucket: stale ? 'stuck_securing' : 'healthy',
      shouldEscalate: stale,
      summary: stale ? 'Booking is securing longer than expected.' : 'Booking is actively securing.',
    };
  }

  return { bookingState, recoveryBucket: 'healthy', shouldEscalate: false, summary: 'Booking is still early in the lifecycle.' };
}
