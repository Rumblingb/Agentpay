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

export interface TripWatchState {
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

  if (mins != null && mins >= 0 && mins <= 60 && trip.phase !== 'arrived') {
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

  const hasUrgentCard = cards.some((card) => card.severity === 'warning');
  if (
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
    arrival_tip: 8,
    destination_suggestion: 9,
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
