import type { ActiveTrip, JourneySession, TripEntry } from './storage';

const UPCOMING_TRAVEL_WINDOW_MS = 36 * 60 * 60 * 1000;
const RECENT_TRAVEL_WINDOW_MS = 6 * 60 * 60 * 1000;
const RECENT_UPDATE_WINDOW_MS = 6 * 60 * 60 * 1000;

function parseMoment(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecentUpdate(value?: string | null): boolean {
  const updatedAt = parseMoment(value);
  return updatedAt != null && Date.now() - updatedAt <= RECENT_UPDATE_WINDOW_MS;
}

function isLiveTravelWindow(value?: string | null): boolean {
  const when = parseMoment(value);
  if (when == null) return false;
  const diff = when - Date.now();
  return diff <= UPCOMING_TRAVEL_WINDOW_MS && diff >= -RECENT_TRAVEL_WINDOW_MS;
}

type TripRoutingInput = {
  status?: string | null;
  departureTime?: string | null;
  tripContext?: ActiveTrip['tripContext'] | TripEntry['tripContext'];
  updatedAt: string;
};

function tripDepartureTime(trip: TripRoutingInput): string | null {
  return trip.departureTime ?? trip.tripContext?.departureTime ?? null;
}

export function shouldPreferJourney(session: Pick<JourneySession, 'state' | 'departureTime' | 'departureDatetime' | 'tripContext' | 'updatedAt'>): boolean {
  switch (session.state) {
    case 'securing':
    case 'payment_pending':
    case 'in_transit':
    case 'arriving':
      return true;
    case 'attention':
      return isRecentUpdate(session.updatedAt);
    case 'ticketed':
      return (
        isLiveTravelWindow(session.departureDatetime ?? session.departureTime ?? session.tripContext?.departureTime ?? null)
        || isRecentUpdate(session.updatedAt)
      );
    default:
      return false;
  }
}

export function shouldTreatTripAsLive(trip: TripRoutingInput): boolean {
  const bookingState = trip.tripContext?.watchState?.bookingState;
  const phase = trip.tripContext?.phase;

  if (trip.status === 'attention' || phase === 'attention') return true;
  if (phase === 'in_transit' || phase === 'arriving') return true;
  if (bookingState === 'securing' || bookingState === 'payment_pending' || bookingState === 'payment_confirmed') return true;

  if (bookingState === 'issued' || trip.status === 'ticketed') {
    return isLiveTravelWindow(tripDepartureTime(trip)) || isRecentUpdate(trip.updatedAt);
  }

  return false;
}
