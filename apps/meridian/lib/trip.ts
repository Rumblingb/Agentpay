import {
  deriveProactiveCards,
  normalizeProactiveCards,
  withTripPhase,
  type ProactiveCard,
  type TripContext,
} from '../../../packages/bro-trip/index';

export type { ProactiveCard, TripContext } from '../../../packages/bro-trip/index';

export function parseTripContext(raw: unknown): TripContext | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as TripContext;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') {
    return raw as TripContext;
  }
  return null;
}

export function tripCards(trip: TripContext | null | undefined): ProactiveCard[] {
  if (!trip) return [];
  return trip.proactiveCards?.length
    ? normalizeProactiveCards(trip.proactiveCards)
    : deriveProactiveCards(trip);
}

export function updateTripContext(
  trip: TripContext | null | undefined,
  phase: TripContext['phase'],
  patch?: Partial<TripContext>,
): TripContext | null {
  if (!trip) return null;
  return withTripPhase(trip, phase, patch);
}

export function paymentConfirmedFromMetadata(metadata: any): boolean {
  return !!(
    metadata?.paymentConfirmed
    || metadata?.stripePaymentConfirmed
    || metadata?.razorpayPaymentConfirmed
  );
}

export function syncTripBookingState(
  trip: TripContext | null | undefined,
  params: {
    phase: TripContext['phase'];
    bookingConfirmed?: boolean;
    paymentConfirmed?: boolean;
    paymentRequired?: boolean;
    failed?: boolean;
    origin?: string;
    destination?: string;
    departureTime?: string;
    arrivalTime?: string;
    operator?: string;
    bookingRef?: string;
    finalLegSummary?: string;
    watchState?: Partial<TripContext['watchState']>;
  },
): TripContext | null {
  if (!trip) return null;

  const paymentRequired = params.paymentRequired ?? true;
  const bookingState = params.failed
    ? 'failed'
    : params.bookingConfirmed && (!paymentRequired || params.paymentConfirmed)
    ? 'issued'
    : params.bookingConfirmed
    ? (paymentRequired ? 'payment_pending' : 'issued')
    : params.paymentConfirmed
    ? 'payment_confirmed'
    : params.phase === 'planning'
    ? 'planned'
    : params.phase === 'securing'
    ? 'securing'
    : 'priced';

  return updateTripContext(trip, params.phase, {
    origin: params.origin ?? trip.origin,
    destination: params.destination ?? trip.destination,
    departureTime: params.departureTime ?? trip.departureTime,
    arrivalTime: params.arrivalTime ?? trip.arrivalTime,
    operator: params.operator ?? trip.operator,
    bookingRef: params.bookingRef ?? trip.bookingRef,
    finalLegSummary: params.finalLegSummary ?? trip.finalLegSummary,
    watchState: {
      ...trip.watchState,
      ...params.watchState,
      bookingState,
      bookingConfirmed: params.failed ? false : (params.bookingConfirmed ?? trip.watchState?.bookingConfirmed),
      paymentConfirmed: params.paymentConfirmed ?? trip.watchState?.paymentConfirmed,
    },
  });
}
