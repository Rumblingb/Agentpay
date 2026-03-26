import {
  buildTripTitle,
  deriveProactiveCards,
  withTripPhase,
  type NearbyPlace,
  type RouteData,
  type TripContext,
  type TripLeg,
  type TripMode,
} from '../../../../packages/bro-trip/index';
import type { FlightOffer } from './duffel';

interface TrainTripDetails {
  departureTime: string;
  arrivalTime?: string;
  operator: string;
  origin: string;
  destination: string;
  departureDatetime?: string;
  finalLegSummary?: string;
  country?: 'uk' | 'india' | 'eu' | 'global';
  transportMode?: 'rail' | 'bus';
}

function modeForTool(toolName: string): TripMode {
  if (toolName === 'book_bus') return 'bus';
  if (toolName === 'search_flights') return 'flight';
  if (toolName === 'book_hotel') return 'hotel';
  if (toolName === 'navigate' || toolName === 'plan_metro') return 'local';
  if (toolName === 'book_restaurant') return 'dining';
  if (toolName === 'discover_events') return 'event';
  return 'rail';
}

function pickOrigin(input: Record<string, unknown>, trainDetails?: TrainTripDetails, flightOffer?: FlightOffer): string | undefined {
  return trainDetails?.origin
    ?? flightOffer?.origin
    ?? (input.origin as string | undefined)
    ?? (input.from as string | undefined)
    ?? undefined;
}

function pickDestination(input: Record<string, unknown>, trainDetails?: TrainTripDetails, flightOffer?: FlightOffer): string | undefined {
  return trainDetails?.destination
    ?? flightOffer?.destination
    ?? (input.destination as string | undefined)
    ?? (input.to as string | undefined)
    ?? (input.location as string | undefined)
    ?? undefined;
}

export function buildPlanTripContext(params: {
  toolName: string;
  input: Record<string, unknown>;
  trainDetails?: TrainTripDetails;
  routeData?: RouteData;
  nearbyPlaces?: NearbyPlace[];
  flightOffer?: FlightOffer;
}): TripContext | undefined {
  const { toolName, input, trainDetails, routeData, nearbyPlaces, flightOffer } = params;
  const mode = modeForTool(toolName);
  const origin = pickOrigin(input, trainDetails, flightOffer);
  const destination = pickDestination(input, trainDetails, flightOffer);
  const finalDestination = (input.final_destination as string | undefined) ?? destination;
  const departureTime = trainDetails?.departureDatetime
    ?? flightOffer?.departureAt
    ?? (input.date as string | undefined);
  const arrivalTime = trainDetails?.arrivalTime ?? flightOffer?.arrivalAt;
  const operator = trainDetails?.operator ?? flightOffer?.carrier;

  const leg: TripLeg = {
    id: `${toolName}-primary`,
    mode,
    label: buildTripTitle(origin, destination, toolName === 'book_restaurant' ? 'Restaurant' : 'Journey'),
    origin,
    destination,
    departureTime,
    arrivalTime,
    operator,
    status: 'planned',
    routeData,
    nearbyPlaces,
    finalLegSummary: trainDetails?.finalLegSummary,
  };

  const trip: TripContext = {
    version: 1,
    mode,
    phase: 'planning',
    status: 'active',
    title: buildTripTitle(origin, destination, leg.label),
    origin,
    destination,
    finalDestination,
    departureTime,
    arrivalTime,
    operator,
    finalLegSummary: trainDetails?.finalLegSummary,
    routeData,
    nearbyPlaces,
    watchState: {
      disruptionWatch: mode === 'rail' || mode === 'bus' || mode === 'flight',
      finalLegReady: !!routeData || !!trainDetails?.finalLegSummary || (nearbyPlaces?.length ?? 0) > 0,
      checkInAt: mode === 'flight' && flightOffer?.departureAt
        ? new Date(new Date(flightOffer.departureAt).getTime() - 24 * 60 * 60 * 1000).toISOString()
        : undefined,
    },
    legs: [leg],
  };

  return { ...trip, proactiveCards: deriveProactiveCards(trip) };
}

export function toExecutingTripContext(
  trip: TripContext | undefined,
  patch?: Partial<TripContext>,
): TripContext | undefined {
  if (!trip) return undefined;
  return withTripPhase({
    ...trip,
    ...patch,
    watchState: {
      ...trip.watchState,
      bookingConfirmed: false,
    },
    legs: trip.legs.map((leg) => ({ ...leg, status: 'securing' })),
  }, 'securing');
}

export function toCompletedTripContext(
  trip: TripContext | undefined,
  patch?: Partial<TripContext>,
): TripContext | undefined {
  if (!trip) return undefined;
  return withTripPhase({
    ...trip,
    ...patch,
    watchState: {
      ...trip.watchState,
      bookingConfirmed: true,
      paymentConfirmed: patch?.watchState?.paymentConfirmed ?? trip.watchState?.paymentConfirmed,
    },
    legs: trip.legs.map((leg) => ({
      ...leg,
      status: 'booked',
      bookingRef: patch?.bookingRef ?? leg.bookingRef,
      origin: patch?.origin ?? leg.origin,
      destination: patch?.destination ?? leg.destination,
      departureTime: patch?.departureTime ?? leg.departureTime,
      arrivalTime: patch?.arrivalTime ?? leg.arrivalTime,
      operator: patch?.operator ?? leg.operator,
      finalLegSummary: patch?.finalLegSummary ?? leg.finalLegSummary,
    })),
  }, 'booked');
}
