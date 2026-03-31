import type { JourneySession } from './storage';

export type JourneyRecoveryBucket =
  | 'healthy'
  | 'awaiting_payment'
  | 'ready_for_dispatch'
  | 'stuck_securing'
  | 'fulfilment_failed'
  | 'issued'
  | 'refunded'
  | 'failed';

export type JourneyRecovery = {
  bookingState: NonNullable<JourneySession['bookingState']> | 'planned' | 'priced';
  bucket: JourneyRecoveryBucket;
  shouldEscalate: boolean;
  statusLabel: string;
  headline: string;
  trustLine: string;
  etaLine: string;
  insightTitle: string;
  insightBody: string;
  supportBody: string;
  priceLabel: string;
  holdLabel: string | null;
  holdValue: string | null;
  voiceLine: string;
};

function minutesSince(value?: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.round((Date.now() - ms) / 60_000);
}

function formatClock(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function inferBookingState(
  session: Pick<JourneySession, 'state' | 'bookingState' | 'tripContext' | 'intentStatus'>,
): NonNullable<JourneySession['bookingState']> | 'planned' | 'priced' {
  const bookingState = session.bookingState ?? session.tripContext?.watchState?.bookingState;
  if (bookingState) return bookingState as NonNullable<JourneySession['bookingState']>;
  if (session.intentStatus === 'refunded') return 'refunded' as NonNullable<JourneySession['bookingState']>;
  switch (session.state) {
    case 'payment_pending':
      return 'payment_pending';
    case 'ticketed':
    case 'in_transit':
    case 'arriving':
      return 'issued';
    case 'attention':
      return 'failed';
    case 'securing':
      return 'securing';
    default:
      return 'planned';
  }
}

export function journeyRecovery(
  session: Pick<
    JourneySession,
    | 'state'
    | 'bookingState'
    | 'tripContext'
    | 'intentStatus'
    | 'quoteExpiresAt'
    | 'paymentConfirmedAt'
    | 'openclawDispatchedAt'
    | 'pendingFulfilment'
    | 'fulfilmentFailed'
    | 'fiatAmount'
  >,
): JourneyRecovery {
  const bookingState = inferBookingState(session);
  const holdValue = formatClock(session.quoteExpiresAt);
  const holdExpired = session.quoteExpiresAt ? Date.parse(session.quoteExpiresAt) <= Date.now() : false;
  const paymentConfirmedMins = minutesSince(session.paymentConfirmedAt);
  const dispatchedMins = minutesSince(session.openclawDispatchedAt);

  if (session.intentStatus === 'refunded' || bookingState === 'refunded') {
    return {
      bookingState,
      bucket: 'refunded',
      shouldEscalate: false,
      statusLabel: 'Refunded',
      headline: 'This journey was safely unwound',
      trustLine: 'Ace cancelled this cleanly instead of leaving you half-booked.',
      etaLine: 'Nothing here is being treated as confirmed. You can ask Ace for the next clean route.',
      insightTitle: 'Nothing partial was left behind',
      insightBody: 'Ace preserved the trip context, but it did not leave a half-issued booking behind.',
      supportBody: 'If you want the next route rebuilt, support and Ace both still have the full journey context.',
      priceLabel: 'Price',
      holdLabel: null,
      holdValue: null,
      voiceLine: 'Ace unwound this journey cleanly. Nothing partial was left behind.',
    };
  }

  if ((bookingState === 'failed' || session.state === 'attention') && session.fulfilmentFailed) {
    return {
      bookingState,
      bucket: 'fulfilment_failed',
      shouldEscalate: true,
      statusLabel: 'Needs attention',
      headline: 'Ticket issue needs intervention',
      trustLine: 'Payment may be clear, but fulfilment did not finish cleanly. Ace kept the journey intact.',
      etaLine: 'You do not need to start over. Support can pick this up from the exact trip state.',
      insightTitle: 'Fulfilment stalled after the route was secured',
      insightBody: 'Ace has the booking context, but ticket issue needs a human check before it is safe to continue.',
      supportBody: 'Ace support can pick this up with the live trip, payment state, and fulfilment context already attached.',
      priceLabel: 'Price',
      holdLabel: null,
      holdValue: null,
      voiceLine: 'Ace hit a fulfilment issue, but the journey context is still intact.',
    };
  }

  if (bookingState === 'failed' || session.state === 'attention') {
    return {
      bookingState,
      bucket: 'failed',
      shouldEscalate: true,
      statusLabel: 'Needs attention',
      headline: 'This journey needs intervention',
      trustLine: 'Something changed before the booking could finish, but Ace still owns the trip context.',
      etaLine: 'You can recover from here without re-explaining the route, timing, or booking state.',
      insightTitle: 'Ace kept the journey intact',
      insightBody: 'The booking did not finish cleanly, but the live route and latest state are still here for recovery.',
      supportBody: 'Support can step in from this exact point without you losing the live route context.',
      priceLabel: 'Price',
      holdLabel: null,
      holdValue: null,
      voiceLine: 'Ace still has this trip, but it needs intervention now.',
    };
  }

  if (bookingState === 'issued' || session.state === 'ticketed' || session.state === 'in_transit' || session.state === 'arriving') {
    return {
      bookingState,
      bucket: 'issued',
      shouldEscalate: false,
      statusLabel: session.state === 'in_transit' ? 'In transit' : session.state === 'arriving' ? 'Arriving' : 'Confirmed',
      headline: 'Your journey is locked in',
      trustLine: session.state === 'in_transit'
        ? 'Ace is watching the live trip and will surface anything material before it becomes a scramble.'
        : session.state === 'arriving'
        ? 'Ace is handling the final stretch so arrival feels calm, not busy.'
        : 'Your booking is locked in and the live journey state is now the source of truth.',
      etaLine: session.state === 'in_transit'
        ? 'Live timing, platform changes, and reroute help stay attached to this journey.'
        : session.state === 'arriving'
        ? 'Arrival details, navigation, and any last-mile help stay attached from here.'
        : 'Receipt, wallet pass, and live journey updates stay connected from here.',
      insightTitle: 'The booking is locked in',
      insightBody: 'Reference, wallet, and live travel updates now all hang off the same journey record.',
      supportBody: 'If anything changes from here, Ace and support still see the full live journey context.',
      priceLabel: 'Price',
      holdLabel: null,
      holdValue: null,
      voiceLine: session.state === 'in_transit'
        ? 'Ace is watching the live trip now.'
        : 'Your journey is locked in.',
    };
  }

  if (bookingState === 'payment_pending' || session.state === 'payment_pending') {
    const trustLine = holdValue && !holdExpired
      ? `Ace is holding this route until ${holdValue}. Payment is the only thing left before ticket issue.`
      : holdExpired
      ? 'The last hold may have expired, but Ace kept the trip context here so you can reopen payment or search again cleanly.'
      : 'The route is held. Payment is the only thing left before ticket issue.';
    return {
      bookingState,
      bucket: 'awaiting_payment',
      shouldEscalate: holdExpired,
      statusLabel: 'Payment needed',
      headline: 'Payment is the only open step',
      trustLine,
      etaLine: holdValue && !holdExpired
        ? `Complete payment before ${holdValue} and Ace can finish issuing the ticket automatically.`
        : 'Once payment clears, Ace can finish issuing the ticket automatically.',
      insightTitle: holdValue && !holdExpired ? 'The fare is still being held' : 'Payment is the only open step',
      insightBody: holdValue && !holdExpired
        ? `Ace already has the journey lined up. Finish payment before ${holdValue} and the ticket can issue cleanly.`
        : 'Ace already has the journey lined up. Once payment clears, ticket issue can finish cleanly.',
      supportBody: holdExpired
        ? 'If the hold dropped or payment feels stuck, support can pick this up without you re-explaining the route.'
        : 'If payment or issue timing feels off, Ace support can pick this up without you re-explaining the route.',
      priceLabel: 'Held fare',
      holdLabel: holdValue ? 'Held until' : null,
      holdValue,
      voiceLine: holdValue && !holdExpired
        ? `Ace is holding this route until ${holdValue}. Payment is the only thing left.`
        : 'Ace is holding the route while payment clears.',
    };
  }

  if (bookingState === 'payment_confirmed') {
    const stale = paymentConfirmedMins != null && paymentConfirmedMins >= 10;
    return {
      bookingState,
      bucket: stale ? 'ready_for_dispatch' : 'healthy',
      shouldEscalate: stale,
      statusLabel: 'Issuing ticket',
      headline: 'Payment cleared. Ace is issuing the ticket',
      trustLine: stale
        ? 'Payment is confirmed, but ticket issue is running longer than usual. Ace still owns the trip.'
        : 'Payment is confirmed. Ace is finishing ticket issue in the background now.',
      etaLine: stale
        ? 'If this keeps dragging, support can pick it up with the live journey and payment state already attached.'
        : 'You can close the app and come back. Ace keeps carrying the issue window from here.',
      insightTitle: 'Payment is confirmed',
      insightBody: stale
        ? 'Ace cleared the payment, but the dispatch window is taking longer than usual.'
        : 'Ace cleared payment and is moving through the final issue window now.',
      supportBody: stale
        ? 'Support can step in with the payment confirmation already attached if ticket issue keeps lagging.'
        : 'Support can still see the payment state if this window starts to drift.',
      priceLabel: 'Price',
      holdLabel: null,
      holdValue: null,
      voiceLine: stale
        ? 'Payment cleared, but ticket issue is taking longer than usual. Ace still has it.'
        : 'Payment cleared. Ace is issuing the ticket now.',
    };
  }

  if (bookingState === 'securing' || session.state === 'securing') {
    const stale = dispatchedMins != null
      ? dispatchedMins >= 15
      : paymentConfirmedMins != null && paymentConfirmedMins >= 20;
    return {
      bookingState,
      bucket: stale ? 'stuck_securing' : 'healthy',
      shouldEscalate: stale,
      statusLabel: 'Booking',
      headline: stale ? 'Ace is still carrying the booking' : 'Ace is handling the booking now',
      trustLine: stale
        ? 'This is taking longer than usual, but Ace still has the live route and booking context intact.'
        : 'Ace is still carrying the booking in the background. You can close the app and come back.',
      etaLine: stale
        ? 'If this does not settle soon, support can step in without you restarting the trip.'
        : 'Most bookings settle inside a few minutes. Ace keeps ownership while this runs.',
      insightTitle: stale ? 'Booking is taking longer than usual' : 'Ace is carrying the live booking flow',
      insightBody: stale
        ? 'Availability, fulfilment, or ticket issue has drifted past the normal window, but Ace kept the full journey intact.'
        : 'Availability, timing, and fulfilment are still moving in the background.',
      supportBody: stale
        ? 'Support can pick this up with the live booking state already attached if it keeps running long.'
        : 'If this starts to drift, support can still step in with the live booking context attached.',
      priceLabel: 'Price',
      holdLabel: null,
      holdValue: null,
      voiceLine: stale
        ? 'Ace is still carrying the booking. It is running longer than usual, but the journey is intact.'
        : 'Ace is carrying the booking through fulfilment now.',
    };
  }

  if (bookingState === 'priced') {
    return {
      bookingState,
      bucket: 'healthy',
      shouldEscalate: false,
      statusLabel: 'Route ready',
      headline: 'Ace has the route lined up',
      trustLine: 'The route is shaped and ready for the next clean step.',
      etaLine: 'Ace has the timing, fare, and route context together from here.',
      insightTitle: 'The route is ready',
      insightBody: 'Ace has the strongest available option lined up before anything moves.',
      supportBody: 'If you need a human, support can still see the route Ace shaped here.',
      priceLabel: 'Price',
      holdLabel: holdValue ? 'Quoted until' : null,
      holdValue,
      voiceLine: 'Ace has the route lined up.',
    };
  }

  return {
    bookingState,
    bucket: 'healthy',
    shouldEscalate: false,
    statusLabel: 'Planning',
    headline: 'Ace is shaping the route',
    trustLine: 'Ace is shaping the strongest way through before anything moves.',
    etaLine: 'This is still early. Ace is gathering the route, timing, and fulfilment context.',
    insightTitle: 'Ace is shaping the route',
    insightBody: 'The journey context is in place and Ace is building from it before anything gets booked.',
    supportBody: 'If you need help later, support can still pick up from the journey Ace shaped here.',
    priceLabel: 'Price',
    holdLabel: null,
    holdValue: null,
    voiceLine: 'Ace is shaping the route now.',
  };
}
