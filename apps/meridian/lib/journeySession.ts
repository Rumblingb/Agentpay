import type { ProactiveCard, TripContext } from '../../../packages/bro-trip/index';
import type { JourneySession } from './storage';

export function journeyDisplayRoute(session: Pick<JourneySession, 'fromStation' | 'toStation' | 'title'>): string {
  const route = [session.fromStation, session.toStation].filter(Boolean).join(' → ');
  return route || session.title;
}

export function journeyStatusLabel(session: JourneySession): string {
  switch (session.state) {
    case 'planning':
      return 'Planning';
    case 'securing':
      return 'Booking underway';
    case 'payment_pending':
      return 'Awaiting payment';
    case 'ticketed':
      return 'Ticketed';
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

export function journeyIsLive(session: JourneySession): boolean {
  return ['planning', 'securing', 'payment_pending', 'ticketed', 'in_transit', 'arriving', 'attention'].includes(session.state);
}

export function journeyPrimaryIntentPrompt(session: JourneySession): string | null {
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
