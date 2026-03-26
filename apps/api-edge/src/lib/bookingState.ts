export type BookingState =
  | 'planned'
  | 'priced'
  | 'payment_pending'
  | 'payment_confirmed'
  | 'securing'
  | 'issued'
  | 'failed'
  | 'refunded';

type BookingMetadata = Record<string, unknown> | null | undefined;

function hasPaymentConfirmation(metadata: BookingMetadata): boolean {
  return metadata?.paymentConfirmed === true
    || metadata?.stripePaymentConfirmed === true
    || metadata?.razorpayPaymentConfirmed === true
    || metadata?.airwallexPaymentConfirmed === true;
}

export function deriveBookingState(intentStatus: string, metadata?: BookingMetadata): BookingState {
  if (intentStatus === 'refunded') return 'refunded';

  if (
    metadata?.fulfilmentFailed === true
    || metadata?.failedAt
    || ['failed', 'expired', 'rejected', 'cancelled'].includes(intentStatus)
  ) {
    return 'failed';
  }

  if (
    metadata?.fulfilledAt
    || metadata?.ticketRef
    || metadata?.pnr
    || ['completed', 'released'].includes(intentStatus)
  ) {
    return 'issued';
  }

  const paymentConfirmed = hasPaymentConfirmation(metadata) || intentStatus === 'confirmed';
  if (
    paymentConfirmed
    && (
      metadata?.pendingFulfilment === true
      || metadata?.openclawDispatched === true
      || metadata?.bookingInProgress === true
    )
  ) {
    return 'securing';
  }

  if (paymentConfirmed) return 'payment_confirmed';

  if (intentStatus === 'escrow_pending' || intentStatus === 'pending') return 'payment_pending';

  if (metadata?.pricedAt || metadata?.quoteExpiresAt || metadata?.quotedAmount) return 'priced';

  return 'planned';
}

export function withBookingState(
  state: BookingState,
  patch?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(patch ?? {}),
    bookingState: state,
    bookingStateUpdatedAt: new Date().toISOString(),
  };
}

export function toJourneyLegStatus(intentStatus: string, metadata?: BookingMetadata): string {
  const state = deriveBookingState(intentStatus, metadata);
  switch (state) {
    case 'issued':
      return 'completed';
    case 'failed':
    case 'refunded':
      return 'failed';
    case 'payment_confirmed':
    case 'securing':
      return 'securing';
    default:
      return 'pending';
  }
}
