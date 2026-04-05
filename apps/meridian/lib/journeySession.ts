import type { ProactiveCard, TripContext } from '../../../packages/bro-trip/index';
import type { JourneySession } from './storage';
import { journeyRecovery } from './journeyRecovery';

export function journeyDisplayRoute(session: Pick<JourneySession, 'fromStation' | 'toStation' | 'title'>): string {
  const route = [session.fromStation, session.toStation].filter(Boolean).join(' → ');
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
      return 'Find alternatives';
    case 'platform_changed':
    case 'gate_changed':
      return 'Got it';
    case 'destination_suggestion':
      return 'Open map';
    case 'leave_now':
      return 'Navigate';
    default:
      return card.ctaLabel ?? null;
  }
}

export function journeyAskAceLabel(session: Pick<JourneySession, 'rerouteOfferActionLabel' | 'rerouteOfferTranscript'>): string {
  if (session.rerouteOfferActionLabel) return session.rerouteOfferActionLabel;
  if (session.rerouteOfferTranscript) return 'Find alternatives';
  return 'Ask Ace';
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
      body: 'Say "reroute me" and Ace will find the next clean option.',
      tone: 'warning',
    });
  } else if (watch?.delayRisk) {
    insights.push({
      key: 'delay',
      title: 'Running late',
      body: 'Ace is watching this leg. Say "what are my options" if timing shifts.',
      tone: 'warning',
    });
  }

  if (session.rerouteOfferTitle && session.rerouteOfferBody) {
    insights.unshift({
      key: 'reroute-offer',
      title: session.rerouteOfferTitle,
      body: session.rerouteOfferActionLabel
        ? `${session.rerouteOfferBody} ${session.rerouteOfferActionLabel}.`
        : session.rerouteOfferBody,
      tone: 'warning',
    });
  }

  if (session.walletPassUrl) {
    insights.push({
      key: 'wallet',
      title: session.walletLastOpenedAt ? 'Pass in Wallet' : 'Add to Wallet',
      body: session.walletLastOpenedAt
        ? 'Your pass is ready on your lock screen.'
        : 'One tap. No app needed at the gate.',
      tone: 'success',
    });
  }

  if (session.supportState === 'requested') {
    insights.push({
      key: 'support-requested',
      title: 'Support is on it',
      body: session.supportSummary
        ? `Last update: ${session.supportSummary}`
        : 'They have the full trip context. No need to re-explain.',
      tone: 'info',
    });
  } else if (session.state === 'attention' || session.state === 'payment_pending' || recovery.shouldEscalate) {
    insights.push({
      key: 'support-ready',
      title: 'Need help?',
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
      detail: 'Timing, fare, and connections are confirmed.',
      state: stateFor('planning'),
    },
    {
      key: 'securing',
      label: 'Booking',
      detail: 'Ace is working through fulfilment now.',
      state: stateFor('securing'),
    },
    {
      key: 'payment',
      label: 'Payment',
      detail: 'Fare secured. One tap to confirm.',
      state: stateFor('payment'),
    },
    {
      key: 'issued',
      label: 'Confirmed',
      detail: 'Reference and pass are ready.',
      state: stateFor('issued'),
    },
    {
      key: 'watching',
      label: 'Live',
      detail: 'Platform, timing, and reroute help stay attached.',
      state: stateFor('watching'),
    },
    ...(session.state === 'attention'
      ? [{
          key: 'attention',
          label: 'Needs you',
          detail: 'Ace kept everything intact. No need to start over.',
          state: stateFor('attention'),
        } satisfies JourneyStep]
      : []),
  ];
}
