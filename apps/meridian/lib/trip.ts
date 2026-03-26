import {
  deriveProactiveCards,
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
  return trip.proactiveCards?.length ? trip.proactiveCards : deriveProactiveCards(trip);
}

export function updateTripContext(
  trip: TripContext | null | undefined,
  phase: TripContext['phase'],
  patch?: Partial<TripContext>,
): TripContext | null {
  if (!trip) return null;
  return withTripPhase(trip, phase, patch);
}
