export type TripMode = 'rail' | 'bus' | 'flight' | 'hotel' | 'local' | 'dining' | 'event' | 'mixed';

export type TripPhase =
  | 'planning'
  | 'securing'
  | 'booked'
  | 'in_transit'
  | 'arriving'
  | 'arrived'
  | 'attention';

export type TripStatus = 'active' | 'completed' | 'attention';

export type ProactiveCardKind =
  | 'leave_now'
  | 'platform_changed'
  | 'delay_risk'
  | 'connection_risk'
  | 'destination_suggestion'
  | 'check_in'
  | 'hotel_checkout'
  | 'gate_changed'
  | 'arrival_tip'
  | 'boarding_tip';

export interface RouteData {
  polylineEncoded: string;
  durationSeconds: number;
  distanceMeters: number;
  steps: Array<{
    instruction: string;
    distanceMeters: number;
    durationSeconds: number;
  }>;
}

export interface NearbyPlace {
  name: string;
  address: string;
  rating?: number;
  lat?: number;
  lon?: number;
}

export interface TripLeg {
  id: string;
  mode: TripMode;
  label?: string;
  origin?: string;
  destination?: string;
  departureTime?: string;
  arrivalTime?: string;
  operator?: string;
  bookingRef?: string;
  status: 'planned' | 'securing' | 'booked' | 'in_transit' | 'completed' | 'attention';
  routeData?: RouteData;
  nearbyPlaces?: NearbyPlace[];
  finalLegSummary?: string;
}

export interface ProactiveCard {
  id: string;
  kind: ProactiveCardKind;
  title: string;
  body: string;
  severity: 'info' | 'success' | 'warning';
  ctaLabel?: string;
}

export interface JourneyGraphNode {
  id: string;
  mode: TripMode;
  label: string;
  status: TripLeg['status'];
  origin?: string;
  destination?: string;
  departureTime?: string;
  arrivalTime?: string;
  operator?: string;
  bookingRef?: string;
  dependsOn?: string[];
}

export interface JourneyGraphChange {
  id: string;
  kind: 'status' | 'timing' | 'connection' | 'arrival';
  title: string;
  body: string;
  severity: 'info' | 'success' | 'warning';
}

export interface JourneyGraph {
  version: 1;
  status: TripStatus;
  totalLegs: number;
  completedLegs: number;
  activeLegId?: string;
  nextLegId?: string;
  nodes: JourneyGraphNode[];
  changes: JourneyGraphChange[];
}

export interface TripWatchState {
  bookingState?: 'planned' | 'priced' | 'payment_pending' | 'payment_confirmed' | 'securing' | 'issued' | 'failed' | 'refunded';
  bookingConfirmed?: boolean;
  paymentConfirmed?: boolean;
  disruptionWatch?: boolean;
  leaveNowAt?: string;
  checkInAt?: string;
  platformInfo?: string;
  gateInfo?: string;
  delayRisk?: boolean;
  connectionRisk?: boolean;
  finalLegReady?: boolean;
}

export interface TripContext {
  version: 1;
  mode: TripMode;
  phase: TripPhase;
  status: TripStatus;
  title: string;
  origin?: string;
  destination?: string;
  finalDestination?: string;
  departureTime?: string;
  arrivalTime?: string;
  operator?: string;
  bookingRef?: string;
  finalLegSummary?: string;
  routeData?: RouteData;
  nearbyPlaces?: NearbyPlace[];
  watchState?: TripWatchState;
  proactiveCards?: ProactiveCard[];
  journeyGraph?: JourneyGraph;
  legs: TripLeg[];
}

export function buildTripTitle(
  origin?: string | null,
  destination?: string | null,
  fallback = 'Journey',
): string {
  if (origin && destination) return `${origin} -> ${destination}`;
  if (destination) return destination;
  if (origin) return origin;
  return fallback;
}

function minutesUntil(iso?: string, nowIso = new Date().toISOString()): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(target) || !Number.isFinite(now)) return null;
  return Math.round((target - now) / 60_000);
}

export function withTripPhase(
  trip: TripContext,
  phase: TripPhase,
  patch?: Partial<TripContext>,
): TripContext {
  return {
    ...trip,
    ...patch,
    phase,
    status: phase === 'attention' ? 'attention' : patch?.status ?? trip.status,
    proactiveCards: patch?.proactiveCards ?? deriveProactiveCards({
      ...trip,
      ...patch,
      phase,
      status: phase === 'attention' ? 'attention' : patch?.status ?? trip.status,
    }),
  };
}

export function deriveProactiveCards(
  trip: TripContext,
  nowIso = new Date().toISOString(),
): ProactiveCard[] {
  const cards: ProactiveCard[] = [];
  const mins = minutesUntil(trip.watchState?.leaveNowAt ?? trip.departureTime, nowIso);
  const isTransitMode = ['rail', 'bus', 'flight', 'local', 'mixed'].includes(trip.mode);
  const hotelCheckInMins = trip.mode === 'hotel' ? minutesUntil(trip.departureTime, nowIso) : null;
  const hotelCheckoutMins = trip.mode === 'hotel' ? minutesUntil(trip.arrivalTime, nowIso) : null;

  if (isTransitMode && mins != null && mins >= 0 && mins <= 60 && trip.phase !== 'arrived') {
    cards.push({
      id: 'leave-now',
      kind: 'leave_now',
      title: mins <= 5 ? 'Leave now' : `Leave in ${mins} min`,
      body: trip.origin && trip.destination
        ? `${trip.origin} to ${trip.destination} is coming up soon.`
        : `${trip.title} starts soon.`,
      severity: mins <= 15 ? 'warning' : 'info',
      ctaLabel: trip.routeData ? 'Open map' : undefined,
    });
  }

  if (trip.watchState?.platformInfo) {
    cards.push({
      id: 'platform-info',
      kind: 'platform_changed',
      title: 'Platform update',
      body: trip.watchState.platformInfo,
      severity: 'warning',
    });
  }

  if (trip.watchState?.gateInfo) {
    cards.push({
      id: 'gate-info',
      kind: 'gate_changed',
      title: 'Gate update',
      body: trip.watchState.gateInfo,
      severity: 'warning',
    });
  }

  if (trip.watchState?.delayRisk) {
    cards.push({
      id: 'delay-risk',
      kind: 'delay_risk',
      title: 'Delay risk',
      body: 'Timing looks tight on this leg.',
      severity: 'warning',
    });
  }

  if (trip.watchState?.connectionRisk) {
    cards.push({
      id: 'connection-risk',
      kind: 'connection_risk',
      title: 'Connection risk',
      body: 'The onward connection could get tight.',
      severity: 'warning',
    });
  }

  if (trip.watchState?.checkInAt && trip.mode === 'flight') {
    cards.push({
      id: 'check-in',
      kind: 'check_in',
      title: 'Check-in window',
      body: `Check-in opens around ${trip.watchState.checkInAt}.`,
      severity: 'info',
    });
  }

  if (trip.mode === 'hotel' && hotelCheckInMins != null && hotelCheckInMins >= 0 && hotelCheckInMins <= 24 * 60) {
    const hoursToCheckIn = Math.max(1, Math.round(hotelCheckInMins / 60));
    cards.push({
      id: 'hotel-check-in',
      kind: 'check_in',
      title: hotelCheckInMins <= 180 ? 'Hotel check-in soon' : `Hotel check-in in ${hoursToCheckIn}h`,
      body: trip.destination
        ? `${trip.destination} stay is coming up. Keep your hotel checkout ready.`
        : 'Hotel check-in is coming up soon.',
      severity: hotelCheckInMins <= 180 ? 'warning' : 'info',
      ctaLabel: 'View stay',
    });
  }

  if (trip.mode === 'hotel' && hotelCheckoutMins != null && hotelCheckoutMins >= 0 && hotelCheckoutMins <= 18 * 60) {
    const hoursToCheckout = Math.max(1, Math.round(hotelCheckoutMins / 60));
    cards.push({
      id: 'hotel-checkout',
      kind: 'hotel_checkout',
      title: hotelCheckoutMins <= 180 ? 'Checkout soon' : `Checkout in ${hoursToCheckout}h`,
      body: trip.destination
        ? `Your stay in ${trip.destination} is nearing checkout time.`
        : 'Your hotel stay is nearing checkout time.',
      severity: hotelCheckoutMins <= 180 ? 'warning' : 'info',
      ctaLabel: 'Review stay',
    });
  }

  const hasUrgentCard = cards.some((card) => card.severity === 'warning');
  if (
    isTransitMode
    && 
    !hasUrgentCard
    && (trip.finalLegSummary || trip.routeData || (trip.nearbyPlaces?.length ?? 0) > 0)
    && ['booked', 'in_transit', 'arriving', 'arrived'].includes(trip.phase)
  ) {
    cards.push({
      id: 'destination',
      kind: 'destination_suggestion',
      title: trip.routeData ? 'Final stretch ready' : 'At destination',
      body: trip.finalLegSummary
        ? trip.finalLegSummary
        : trip.finalDestination
        ? `Bro can guide you the rest of the way to ${trip.finalDestination}.`
        : 'Bro can keep the last stretch moving after arrival.',
      severity: 'info',
      ctaLabel: trip.routeData || (trip.nearbyPlaces?.length ?? 0) > 0 ? 'Open map' : undefined,
    });
  }

  return normalizeProactiveCards(cards);
}

export function normalizeProactiveCards(cards: ProactiveCard[]): ProactiveCard[] {
  const seen = new Set<ProactiveCardKind>();
  const priority: Record<ProactiveCardKind, number> = {
    platform_changed: 1,
    gate_changed: 2,
    leave_now: 3,
    connection_risk: 4,
    delay_risk: 5,
    boarding_tip: 6,
    check_in: 7,
    hotel_checkout: 8,
    arrival_tip: 9,
    destination_suggestion: 10,
  };
  return cards
    .filter((card) => {
      if (seen.has(card.kind)) return false;
      seen.add(card.kind);
      return true;
    })
    .sort((a, b) => {
      const severityRank = (value: ProactiveCard['severity']) =>
        value === 'warning' ? 0 : value === 'success' ? 1 : 2;
      return severityRank(a.severity) - severityRank(b.severity)
        || priority[a.kind] - priority[b.kind];
    });
}
