import type { ProactiveCard, TripContext } from '../../../packages/bro-trip/index';
import type { JourneySession } from './storage';

export function journeyDisplayRoute(session: Pick<JourneySession, 'fromStation' | 'toStation' | 'title'>): string {
  const route = [session.fromStation, session.toStation].filter(Boolean).join(' -> ');
  return route || session.title;
}

export function journeyStatusLabel(session: JourneySession): string {
  switch (session.state) {
    case 'planning':
      return 'Planning';
    case 'securing':
      return 'Booking';
    case 'payment_pending':
      return 'Payment needed';
    case 'ticketed':
      return 'Confirmed';
    case 'in_transit':
      return 'In transit';
    case 'arriving':
      return 'Arriving';
    case 'attention':
      return 'Needs attention';
    default:
      return 'Journey';
  }
}

export function journeyTrustLine(session: JourneySession): string {
  switch (session.state) {
    case 'planning':
      return 'Ace is shaping the strongest way through before anything moves.';
    case 'securing':
      return 'Ace is still carrying the booking in the background. You can close the app and come back.';
    case 'payment_pending':
      return 'The route is held. Once payment clears, Ace can finish issuing the ticket cleanly.';
    case 'ticketed':
      return 'Your booking is locked in and the live journey state is now the source of truth.';
    case 'in_transit':
      return 'Ace is watching the live trip and will surface anything that materially changes.';
    case 'arriving':
      return 'Ace is handling the last stretch so arrival feels calm, not busy.';
    case 'attention':
      return 'Something changed, but Ace still has the context and can guide the next clean step.';
    default:
      return 'Ace is keeping this journey together for you.';
  }
}

export function journeyEtaLine(session: JourneySession): string {
  if (session.state === 'payment_pending') {
    return 'The route is ready. Payment is the only step left before ticket issue.';
  }
  if (session.state === 'securing') {
    return 'Most bookings settle within a few minutes. If this one runs long, Ace keeps ownership.';
  }
  if (session.state === 'attention') {
    return 'Ace will hold the trip context here until you decide the next move.';
  }
  if (session.state === 'ticketed') {
    return 'Receipt, wallet pass, and live journey updates stay connected from here.';
  }
  return journeyTrustLine(session);
}

export function journeyIsLive(session: JourneySession): boolean {
  return ['planning', 'securing', 'payment_pending', 'ticketed', 'in_transit', 'arriving', 'attention'].includes(session.state);
}

export function journeyPrimaryIntentPrompt(session: JourneySession): string | null {
  if (session.rerouteOfferTranscript) return session.rerouteOfferTranscript;
  if (session.fromStation && session.toStation) {
    if (session.state === 'attention') return `${session.fromStation} to ${session.toStation} next available`;
    return `${session.fromStation} to ${session.toStation} again`;
  }
  return null;
}

export function journeyProactiveActionLabel(card: ProactiveCard): string | null {
  switch (card.kind) {
    case 'delay_risk':
    case 'connection_risk':
    case 'platform_changed':
    case 'gate_changed':
      return 'Ask Ace to reroute';
    case 'destination_suggestion':
      return 'Open map';
    case 'leave_now':
      return 'Navigate';
    default:
      return card.ctaLabel ?? null;
  }
}

export function inferJourneyWalletUrl(tripContext: TripContext | null | undefined, fallback?: string | null): string | null {
  if (fallback) return fallback;
  const context = tripContext as any;
  return context?.walletPassUrl ?? context?.appleWalletUrl ?? context?.passUrl ?? null;
}

export type JourneyInsight = {
  key: string;
  title: string;
  body: string;
  tone: 'neutral' | 'info' | 'warning' | 'success';
};

export function journeyInsights(session: JourneySession): JourneyInsight[] {
  const insights: JourneyInsight[] = [];
  const watch = session.tripContext?.watchState;
  const bookingState = session.bookingState ?? watch?.bookingState;

  if (bookingState === 'payment_pending') {
    insights.push({
      key: 'payment',
      title: 'Payment is the only open step',
      body: 'Ace has the trip lined up already. Once payment clears, ticket issue can finish cleanly.',
      tone: 'info',
    });
  } else if (session.state === 'securing') {
    insights.push({
      key: 'securing',
      title: 'Ace is carrying the live booking flow',
      body: 'Availability, timing, and fulfilment are still moving in the background.',
      tone: 'neutral',
    });
  } else if (session.state === 'ticketed') {
    insights.push({
      key: 'ticketed',
      title: 'The booking is locked in',
      body: 'Reference, wallet, and travel-day reminders now all hang off the same journey record.',
      tone: 'success',
    });
  }

  if (watch?.platformInfo) {
    insights.push({
      key: 'platform',
      title: 'Platform changed',
      body: watch.platformInfo,
      tone: 'warning',
    });
  }

  if (watch?.gateInfo) {
    insights.push({
      key: 'gate',
      title: 'Gate changed',
      body: watch.gateInfo,
      tone: 'warning',
    });
  }

  if (watch?.connectionRisk) {
    insights.push({
      key: 'connection',
      title: 'Connection looks tight',
      body: 'Ace can line up the next clean option before this turns into a scramble.',
      tone: 'warning',
    });
  } else if (watch?.delayRisk) {
    insights.push({
      key: 'delay',
      title: 'Timing needs watching',
      body: 'Ace sees disruption risk on this leg and is ready to reroute if it becomes material.',
      tone: 'warning',
    });
  }

  if (session.rerouteOfferTitle && session.rerouteOfferBody) {
    insights.unshift({
      key: 'reroute-offer',
      title: session.rerouteOfferTitle,
      body: session.rerouteOfferBody,
      tone: 'warning',
    });
  }

  if (session.walletPassUrl) {
    insights.push({
      key: 'wallet',
      title: session.walletLastOpenedAt ? 'Wallet pass is on hand' : 'Wallet pass is ready',
      body: session.walletLastOpenedAt
        ? 'Ace can reopen the pass whenever you need it at the gate.'
        : 'You can move this ticket into Apple Wallet so Ace becomes invisible at the gate.',
      tone: 'success',
    });
  }

  if (session.supportState === 'requested') {
    insights.push({
      key: 'support-requested',
      title: 'Support already has this trip',
      body: session.supportSummary
        ? `Ace passed the latest issue through: ${session.supportSummary}`
        : 'You do not need to re-explain the route. Ace support has the live journey context already.',
      tone: 'info',
    });
  } else if (session.state === 'attention' || session.state === 'payment_pending') {
    insights.push({
      key: 'support-ready',
      title: 'Help can pick up from here',
      body: 'If this needs a human, Ace support can take over with the trip context already attached.',
      tone: 'neutral',
    });
  }

  return insights.slice(0, 4);
}

export type JourneyStep = {
  key: string;
  label: string;
  detail: string;
  state: 'done' | 'current' | 'upcoming';
};

export function journeySteps(session: JourneySession): JourneyStep[] {
  const bookingState = session.bookingState ?? session.tripContext?.watchState?.bookingState;
  const current =
    session.state === 'attention' ? 'attention'
    : session.state === 'in_transit' || session.state === 'arriving' ? 'watching'
    : session.state === 'ticketed' ? 'issued'
    : bookingState === 'payment_pending' ? 'payment'
    : session.state === 'securing' ? 'securing'
    : 'planning';

  const order = ['planning', 'securing', 'payment', 'issued', 'watching', 'attention'] as const;
  const currentIndex = order.indexOf(current as (typeof order)[number]);

  const stateFor = (key: (typeof order)[number]): JourneyStep['state'] => {
    if (key === current) return 'current';
    if (currentIndex >= 0 && order.indexOf(key) < currentIndex && current !== 'attention') return 'done';
    if (current === 'attention' && key === 'attention') return 'current';
    if (current === 'attention' && ['planning', 'securing', 'payment'].includes(key)) return 'done';
    return 'upcoming';
  };

  return [
    {
      key: 'planning',
      label: 'Route shaped',
      detail: 'Ace has the journey context and the route it is working from.',
      state: stateFor('planning'),
    },
    {
      key: 'securing',
      label: 'Booking carried',
      detail: 'Ace is moving through the live fulfilment steps on your behalf.',
      state: stateFor('securing'),
    },
    {
      key: 'payment',
      label: 'Payment cleared',
      detail: 'Only shown when the route needs a payment step before issue.',
      state: stateFor('payment'),
    },
    {
      key: 'issued',
      label: 'Ticket issued',
      detail: 'Reference, wallet pass, and trip details are ready.',
      state: stateFor('issued'),
    },
    {
      key: 'watching',
      label: 'Journey watched live',
      detail: 'Ace keeps monitoring the trip for timing, platform, and reroute changes.',
      state: stateFor('watching'),
    },
    ...(session.state === 'attention'
      ? [{
          key: 'attention',
          label: 'Human attention needed',
          detail: 'Ace kept the journey context intact so you can fix this without starting over.',
          state: stateFor('attention'),
        } satisfies JourneyStep]
      : []),
  ];
}
