import type { ProactiveCard, TripContext } from '../../../packages/bro-trip/index';
import type { JourneySession } from './storage';
import { journeyRecovery } from './journeyRecovery';

export function journeyDisplayRoute(session: Pick<JourneySession, 'fromStation' | 'toStation' | 'title'>): string {
  const route = [session.fromStation, session.toStation].filter(Boolean).join(' -> ');
  return route || session.title;
}

export function journeyStatusLabel(session: JourneySession): string {
  return journeyRecovery(session).statusLabel;
}

export function journeyTrustLine(session: JourneySession): string {
  return journeyRecovery(session).trustLine;
}

export function journeyEtaLine(session: JourneySession): string {
  return journeyRecovery(session).etaLine;
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
  const recovery = journeyRecovery(session);
  const watch = session.tripContext?.watchState;
  insights.push({
    key: 'recovery',
    title: recovery.insightTitle,
    body: recovery.insightBody,
    tone:
      recovery.bucket === 'issued' ? 'success'
      : recovery.bucket === 'awaiting_payment' || recovery.bucket === 'ready_for_dispatch' ? 'info'
      : recovery.shouldEscalate ? 'warning'
      : 'neutral',
  });

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
  } else if (session.state === 'attention' || session.state === 'payment_pending' || recovery.shouldEscalate) {
    insights.push({
      key: 'support-ready',
      title: 'Help can pick up from here',
      body: recovery.supportBody,
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
