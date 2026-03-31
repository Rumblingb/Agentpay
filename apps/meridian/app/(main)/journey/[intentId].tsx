import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createCheckoutSession, createUpiPaymentLink, getIntentStatus, reportIssue } from '../../../lib/api';
import { AceMark } from '../../../components/AceMark';
import {
  journeyDisplayRoute,
  journeyEtaLine,
  journeyInsights,
  journeyIsLive,
  journeyPrimaryIntentPrompt,
  journeyProactiveActionLabel,
  journeyStatusLabel,
  journeySteps,
  journeyTrustLine,
} from '../../../lib/journeySession';
import { journeyRecovery } from '../../../lib/journeyRecovery';
import { loadJourneySession, patchJourneySession, saveJourneySession, type JourneySession } from '../../../lib/storage';
import { parseTripContext, paymentConfirmedFromMetadata, syncTripBookingState, tripCards, type TripContext } from '../../../lib/trip';
import { trackClientEvent } from '../../../lib/telemetry';
import { C } from '../../../lib/theme';
import { useStore } from '../../../lib/store';

function sessionTone(session: JourneySession) {
  switch (session.state) {
    case 'attention':
      return { border: '#92400e', bg: '#1c1917', text: '#fbbf24' };
    case 'payment_pending':
      return { border: '#1d4ed8', bg: '#0f172a', text: '#93c5fd' };
    case 'ticketed':
    case 'in_transit':
    case 'arriving':
      return { border: '#166534', bg: '#052e16', text: '#86efac' };
    default:
      return { border: '#334155', bg: '#0b1220', text: '#cbd5e1' };
  }
}

function statusLookupId(session: JourneySession): string {
  return session.jobId || session.intentId || '';
}

function relativeDepartureLabel(value?: string | null): string | null {
  if (!value) return null;
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return null;
  const diffMinutes = Math.round((when.getTime() - Date.now()) / 60_000);
  if (diffMinutes <= 0) return 'Now';
  if (diffMinutes < 60) return `In ${diffMinutes} min`;
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  return minutes > 0 ? `In ${hours}h ${minutes}m` : `In ${hours}h`;
}

function timelineLegs(trip: TripContext | null | undefined) {
  return trip?.legs ?? [];
}

export default function JourneyScreen() {
  const { intentId, rerouteTitle, rerouteBody, rerouteTranscript } = useLocalSearchParams<{
    intentId: string;
    rerouteTitle?: string;
    rerouteBody?: string;
    rerouteTranscript?: string;
  }>();
  const [session, setSession] = useState<JourneySession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [walletTrackedFor, setWalletTrackedFor] = useState<string | null>(null);
  const [rerouteTrackedFor, setRerouteTrackedFor] = useState<string | null>(null);
  const [acknowledgedSignalIds, setAcknowledgedSignalIds] = useState<string[]>([]);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueCategory, setIssueCategory] = useState<'payment' | 'delay' | 'ticket' | 'other'>('delay');
  const [issueText, setIssueText] = useState('');
  const [issueSending, setIssueSending] = useState(false);
  const [issueSent, setIssueSent] = useState(false);
  const [payLoading, setPayLoading] = useState(false);
  const [paymentCheckLoading, setPaymentCheckLoading] = useState(false);
  const [paymentRecoveryNote, setPaymentRecoveryNote] = useState<string | null>(null);
  const { agentId } = useStore();

  const logJourneyEvent = useCallback((params: {
    event: string;
    severity?: 'info' | 'warning' | 'error';
    message?: string;
    metadata?: Record<string, unknown>;
  }) => {
    void trackClientEvent({
      event: params.event,
      screen: 'journey',
      severity: params.severity,
      message: params.message,
      metadata: params.metadata,
    });
  }, []);

  const syncLiveStatus = useCallback(async (currentSession: JourneySession) => {
    const lookupId = statusLookupId(currentSession);
    if (!lookupId) return currentSession;

    const data = await getIntentStatus(lookupId);
    const proof = data.metadata?.completionProof ?? {};
    const serverTrip = parseTripContext(data.metadata?.tripContext) ?? currentSession.tripContext ?? null;
    const paymentConfirmed = paymentConfirmedFromMetadata(data.metadata);
    const nextTripContext = serverTrip
      ? syncTripBookingState(serverTrip, {
          phase:
            data.status === 'completed' || data.status === 'confirmed' || data.status === 'verified'
              ? 'booked'
              : data.status === 'failed' || data.status === 'expired' || data.status === 'rejected'
              ? 'attention'
              : serverTrip.phase,
          bookingConfirmed: ['completed', 'confirmed', 'verified'].includes(data.status),
          paymentConfirmed,
          paymentRequired: !!(currentSession.fiatAmount && currentSession.fiatAmount > 0),
          bookingRef: proof.bookingRef ?? currentSession.bookingRef ?? undefined,
          origin: proof.fromStation ?? currentSession.fromStation ?? undefined,
          destination: proof.toStation ?? currentSession.toStation ?? undefined,
          departureTime:
            proof.departureDatetime
            ?? proof.departureTime
            ?? currentSession.departureDatetime
            ?? currentSession.departureTime
            ?? undefined,
          arrivalTime: proof.arrivalTime ?? currentSession.arrivalTime ?? undefined,
          operator: proof.operator ?? currentSession.operator ?? undefined,
          finalLegSummary: proof.finalLegSummary ?? currentSession.finalLegSummary ?? undefined,
          failed: ['failed', 'expired', 'rejected'].includes(data.status),
        })
      : null;

    const nextSession: JourneySession = {
      ...currentSession,
      intentId: data.intentId ?? currentSession.intentId,
      intentStatus: data.status ?? currentSession.intentStatus ?? null,
      title: nextTripContext?.title ?? currentSession.title,
      state:
        ['failed', 'expired', 'rejected'].includes(data.status) ? 'attention'
        : nextTripContext?.phase === 'in_transit' ? 'in_transit'
        : nextTripContext?.phase === 'arriving' || nextTripContext?.phase === 'arrived' ? 'arriving'
        : nextTripContext?.watchState?.bookingState === 'payment_pending' ? 'payment_pending'
        : ['completed', 'confirmed', 'verified'].includes(data.status) ? 'ticketed'
        : currentSession.state,
      bookingState: nextTripContext?.watchState?.bookingState ?? currentSession.bookingState,
      fromStation: proof.fromStation ?? currentSession.fromStation ?? null,
      toStation: proof.toStation ?? currentSession.toStation ?? null,
      departureTime: proof.departureTime ?? currentSession.departureTime ?? null,
      departureDatetime: proof.departureDatetime ?? currentSession.departureDatetime ?? null,
      arrivalTime: proof.arrivalTime ?? currentSession.arrivalTime ?? null,
      platform: proof.platform ?? currentSession.platform ?? null,
      operator: proof.operator ?? currentSession.operator ?? null,
      bookingRef: proof.bookingRef ?? currentSession.bookingRef ?? null,
      finalLegSummary: proof.finalLegSummary ?? currentSession.finalLegSummary ?? null,
      tripContext: nextTripContext ?? currentSession.tripContext,
      shareToken: data.metadata?.shareToken ?? currentSession.shareToken ?? null,
      walletPassUrl:
        data.metadata?.walletPassUrl
        ?? data.metadata?.appleWalletUrl
        ?? data.metadata?.passUrl
        ?? currentSession.walletPassUrl
        ?? null,
      quoteExpiresAt: data.metadata?.quoteExpiresAt ?? data.metadata?.expiresAt ?? currentSession.quoteExpiresAt ?? null,
      paymentConfirmedAt: data.metadata?.paymentConfirmedAt ?? currentSession.paymentConfirmedAt ?? null,
      openclawDispatchedAt: data.metadata?.openclawDispatchedAt ?? currentSession.openclawDispatchedAt ?? null,
      pendingFulfilment:
        typeof data.metadata?.pendingFulfilment === 'boolean'
          ? data.metadata.pendingFulfilment
          : currentSession.pendingFulfilment ?? null,
      fulfilmentFailed: data.metadata?.fulfilmentFailed === true ? true : currentSession.fulfilmentFailed ?? null,
      rerouteOfferTitle: data.metadata?.rerouteOfferTitle ?? currentSession.rerouteOfferTitle ?? null,
      rerouteOfferBody: data.metadata?.rerouteOfferBody ?? currentSession.rerouteOfferBody ?? null,
      rerouteOfferTranscript: data.metadata?.rerouteOfferTranscript ?? currentSession.rerouteOfferTranscript ?? null,
      updatedAt: new Date().toISOString(),
    };

    await saveJourneySession(nextSession);
    setSession(nextSession);
    setError(null);
    return nextSession;
  }, []);

  const refreshSession = useCallback(async () => {
    if (!intentId) return;
    setLoading(true);
    try {
      const stored = await loadJourneySession(intentId);
      if (!stored) {
        setError('Ace could not find this journey yet.');
        setSession(null);
        return;
      }
      setSession(stored);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [intentId]);

  useFocusEffect(useCallback(() => {
    void refreshSession();
  }, [refreshSession]));

  useEffect(() => {
    if (!session || !journeyIsLive(session)) return;

    const interval = setInterval(() => {
      void (async () => {
        try {
          await syncLiveStatus(session);
          return;
          /*
          const data = await getIntentStatus(lookupId);
          const proof = data.metadata?.completionProof ?? {};
          const serverTrip = parseTripContext(data.metadata?.tripContext) ?? session.tripContext ?? null;
          const paymentConfirmed = paymentConfirmedFromMetadata(data.metadata);
          const nextTripContext = serverTrip
            ? syncTripBookingState(serverTrip, {
                phase:
                  data.status === 'completed' || data.status === 'confirmed' || data.status === 'verified'
                    ? 'booked'
                    : data.status === 'failed' || data.status === 'expired' || data.status === 'rejected'
                    ? 'attention'
                    : serverTrip.phase,
                bookingConfirmed: ['completed', 'confirmed', 'verified'].includes(data.status),
                paymentConfirmed,
                paymentRequired: !!(session.fiatAmount && session.fiatAmount > 0),
                bookingRef: proof.bookingRef ?? session.bookingRef ?? undefined,
                origin: proof.fromStation ?? session.fromStation ?? undefined,
                destination: proof.toStation ?? session.toStation ?? undefined,
                departureTime:
                  proof.departureDatetime
                  ?? proof.departureTime
                  ?? session.departureDatetime
                  ?? session.departureTime
                  ?? undefined,
                arrivalTime: proof.arrivalTime ?? session.arrivalTime ?? undefined,
                operator: proof.operator ?? session.operator ?? undefined,
                finalLegSummary: proof.finalLegSummary ?? session.finalLegSummary ?? undefined,
                failed: ['failed', 'expired', 'rejected'].includes(data.status),
              })
            : null;

          const nextSession: JourneySession = {
            ...session,
            intentId: data.intentId ?? session.intentId,
            intentStatus: data.status ?? session.intentStatus ?? null,
            title: nextTripContext?.title ?? session.title,
            state:
              ['failed', 'expired', 'rejected'].includes(data.status) ? 'attention'
              : nextTripContext?.phase === 'in_transit' ? 'in_transit'
              : nextTripContext?.phase === 'arriving' || nextTripContext?.phase === 'arrived' ? 'arriving'
              : nextTripContext?.watchState?.bookingState === 'payment_pending' ? 'payment_pending'
              : ['completed', 'confirmed', 'verified'].includes(data.status) ? 'ticketed'
              : session.state,
            bookingState: nextTripContext?.watchState?.bookingState ?? session.bookingState,
            fromStation: proof.fromStation ?? session.fromStation ?? null,
            toStation: proof.toStation ?? session.toStation ?? null,
            departureTime: proof.departureTime ?? session.departureTime ?? null,
            departureDatetime: proof.departureDatetime ?? session.departureDatetime ?? null,
            arrivalTime: proof.arrivalTime ?? session.arrivalTime ?? null,
            platform: proof.platform ?? session.platform ?? null,
            operator: proof.operator ?? session.operator ?? null,
            bookingRef: proof.bookingRef ?? session.bookingRef ?? null,
            finalLegSummary: proof.finalLegSummary ?? session.finalLegSummary ?? null,
            tripContext: nextTripContext ?? session.tripContext,
            shareToken: data.metadata?.shareToken ?? session.shareToken ?? null,
            walletPassUrl:
              data.metadata?.walletPassUrl
              ?? data.metadata?.appleWalletUrl
              ?? data.metadata?.passUrl
              ?? session.walletPassUrl
              ?? null,
            quoteExpiresAt: data.metadata?.quoteExpiresAt ?? data.metadata?.expiresAt ?? session.quoteExpiresAt ?? null,
            paymentConfirmedAt: data.metadata?.paymentConfirmedAt ?? session.paymentConfirmedAt ?? null,
            openclawDispatchedAt: data.metadata?.openclawDispatchedAt ?? session.openclawDispatchedAt ?? null,
            pendingFulfilment:
              typeof data.metadata?.pendingFulfilment === 'boolean'
                ? data.metadata.pendingFulfilment
                : session.pendingFulfilment ?? null,
            fulfilmentFailed: data.metadata?.fulfilmentFailed === true ? true : session.fulfilmentFailed ?? null,
            // Reroute offer — written by platformWatch cron when disruption is detected.
            // Survives app restarts because it lives on the session record.
            rerouteOfferTitle:      data.metadata?.rerouteOfferTitle      ?? session.rerouteOfferTitle      ?? null,
            rerouteOfferBody:       data.metadata?.rerouteOfferBody       ?? session.rerouteOfferBody       ?? null,
            rerouteOfferTranscript: data.metadata?.rerouteOfferTranscript ?? session.rerouteOfferTranscript ?? null,
            updatedAt: new Date().toISOString(),
          };

          await saveJourneySession(nextSession);
          setSession(nextSession);
          */
        } catch {
          // Keep the last durable session and stay calm.
        }
      })();
    }, 8000);

    return () => clearInterval(interval);
  }, [session, syncLiveStatus]);

  useEffect(() => {
    if (!intentId || !session) return;
    const nextTitle = rerouteTitle?.trim() || null;
    const nextBody = rerouteBody?.trim() || null;
    const nextTranscript = rerouteTranscript?.trim() || null;
    const changed =
      (nextTitle && nextTitle !== session.rerouteOfferTitle)
      || (nextBody && nextBody !== session.rerouteOfferBody)
      || (nextTranscript && nextTranscript !== session.rerouteOfferTranscript);
    if (!changed) return;

    const nextSession: JourneySession = {
      ...session,
      rerouteOfferTitle: nextTitle ?? session.rerouteOfferTitle ?? null,
      rerouteOfferBody: nextBody ?? session.rerouteOfferBody ?? null,
      rerouteOfferTranscript: nextTranscript ?? session.rerouteOfferTranscript ?? null,
      lastEventKey: 'reroute_offer',
      lastEventAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setSession(nextSession);
    void patchJourneySession(intentId, nextSession);
    logJourneyEvent({
      event: 'reroute_offer_viewed',
      metadata: { intentId },
    });
  }, [intentId, logJourneyEvent, rerouteBody, rerouteTitle, rerouteTranscript, session]);

  useEffect(() => {
    setAcknowledgedSignalIds([]);
  }, [session?.intentId]);

  useEffect(() => {
    if (!session?.walletPassUrl || walletTrackedFor === session.intentId) return;
    setWalletTrackedFor(session.intentId);
    logJourneyEvent({
      event: 'wallet_available',
      metadata: { intentId: session.intentId, source: 'journey' },
    });
  }, [logJourneyEvent, session, walletTrackedFor]);

  useEffect(() => {
    if (!session?.rerouteOfferTranscript || rerouteTrackedFor === session.intentId) return;
    setRerouteTrackedFor(session.intentId);
    logJourneyEvent({
      event: 'reroute_offer_available',
      metadata: { intentId: session.intentId, source: 'journey' },
    });
  }, [logJourneyEvent, rerouteTrackedFor, session]);

  const cards = useMemo(() => tripCards(session?.tripContext), [session?.tripContext]);
  const visibleCards = useMemo(
    () => cards.filter((card) => !acknowledgedSignalIds.includes(card.id)),
    [acknowledgedSignalIds, cards],
  );
  const recovery = useMemo(() => (session ? journeyRecovery(session) : null), [session]);
  const insights = useMemo(() => (session ? journeyInsights(session) : []), [session]);
  const steps = useMemo(() => (session ? journeySteps(session) : []), [session]);
  const legs = useMemo(() => timelineLegs(session?.tripContext), [session?.tripContext]);
  const tone = session ? sessionTone(session) : null;
  const routeLabel = session ? journeyDisplayRoute(session) : '';
  const repeatPrompt = session ? journeyPrimaryIntentPrompt(session) : null;
  const departureCountdown = relativeDepartureLabel(session?.departureDatetime ?? session?.departureTime ?? null);
  const liveHeadline = departureCountdown
    ? departureCountdown === 'Now'
      ? 'Departs now'
      : `Departs ${departureCountdown.toLowerCase()}`
    : journeyStatusLabel(session);
  const showLiveCountdown = ['ticketed', 'in_transit', 'arriving'].includes(session.state)
    && !!(departureCountdown || session.platform || session.toStation);
  const isAwaitingPayment = recovery?.bucket === 'awaiting_payment';
  const priceValue =
    session.fiatAmount != null && session.currencySymbol
      ? `${session.currencySymbol}${session.fiatAmount.toFixed(2)}`
      : null;

  const openReceipt = useCallback(() => {
    if (!session) return;
    router.push({
      pathname: '/(main)/receipt/[intentId]',
      params: {
        intentId: session.intentId,
        bookingRef: session.bookingRef ?? undefined,
        fromStation: session.fromStation ?? undefined,
        toStation: session.toStation ?? undefined,
        departureTime: session.departureTime ?? undefined,
        platform: session.platform ?? undefined,
        operator: session.operator ?? undefined,
        finalLegSummary: session.finalLegSummary ?? undefined,
        fiatAmount: session.fiatAmount != null ? String(session.fiatAmount) : undefined,
        currencySymbol: session.currencySymbol ?? undefined,
        currencyCode: session.currencyCode ?? undefined,
        tripContext: session.tripContext ? JSON.stringify(session.tripContext) : undefined,
        shareToken: session.shareToken ?? undefined,
        partnerCheckoutUrl: session.walletPassUrl?.endsWith('.pkpass') ? session.walletPassUrl : undefined,
      },
    });
  }, [session]);

  const openStatus = useCallback(() => {
    if (!session?.jobId) return;
    router.push({
      pathname: '/(main)/status/[jobId]',
      params: {
        jobId: session.jobId,
        intentId: session.intentId,
        fiatAmount: session.fiatAmount != null ? String(session.fiatAmount) : undefined,
        currencySymbol: session.currencySymbol ?? undefined,
        currencyCode: session.currencyCode ?? undefined,
        tripContext: session.tripContext ? JSON.stringify(session.tripContext) : undefined,
        shareToken: session.shareToken ?? undefined,
        journeyId: session.journeyId ?? undefined,
      },
    });
  }, [session]);

  const openWallet = useCallback(async () => {
    if (!session?.walletPassUrl) return;
    try {
      await Linking.openURL(session.walletPassUrl);
      const openedAt = new Date().toISOString();
      setSession((current) => current ? { ...current, walletLastOpenedAt: openedAt, updatedAt: openedAt } : current);
      void patchJourneySession(session.intentId, {
        walletLastOpenedAt: openedAt,
        updatedAt: openedAt,
      });
      logJourneyEvent({
        event: 'wallet_opened',
        metadata: { intentId: session.intentId, source: 'journey' },
      });
    } catch (error: any) {
      logJourneyEvent({
        event: 'wallet_open_failed',
        severity: 'warning',
        message: error?.message ?? 'Wallet failed to open from Journey.',
        metadata: { intentId: session.intentId, source: 'journey' },
      });
    }
  }, [logJourneyEvent, session]);

  const openPaymentFlow = useCallback(async () => {
    if (!session || payLoading) return;
    const jobId = session.jobId ?? session.intentId;
    const amount = session.fiatAmount;
    if (!jobId || !amount) return;

    setPayLoading(true);
    setPaymentRecoveryNote('Complete payment, then return here. Ace will keep carrying the held route.');
    logJourneyEvent({
      event: 'payment_recovery_opened',
      metadata: {
        intentId: session.intentId,
        currencyCode: session.currencyCode ?? 'GBP',
        source: 'journey',
      },
    });

    try {
      if ((session.currencyCode ?? 'GBP').toUpperCase() === 'INR') {
        const { shortUrl } = await createUpiPaymentLink({
          jobId,
          journeyId: session.journeyId ?? undefined,
          amountInr: Math.round(amount),
          description: [session.fromStation, session.toStation].filter(Boolean).join(' -> ') || 'Ace booking',
        });
        await Linking.openURL(shortUrl);
      } else {
        const { url } = await createCheckoutSession({
          jobId,
          journeyId: session.journeyId ?? undefined,
          amountFiat: amount,
          currencyCode: session.currencyCode ?? 'GBP',
          description: [session.fromStation, session.toStation].filter(Boolean).join(' -> ') || 'Ace booking',
        });
        await Linking.openURL(url);
      }
    } catch (error: any) {
      const message = error?.message ?? 'Ace could not reopen payment right now.';
      setPaymentRecoveryNote(message);
      setError(message);
      logJourneyEvent({
        event: 'payment_recovery_failed',
        severity: 'warning',
        message,
        metadata: { intentId: session.intentId, source: 'journey' },
      });
    } finally {
      setPayLoading(false);
    }
  }, [logJourneyEvent, payLoading, session]);

  const checkPaymentNow = useCallback(async () => {
    if (!session || paymentCheckLoading) return;
    setPaymentCheckLoading(true);
    setPaymentRecoveryNote('Checking payment now...');
    logJourneyEvent({
      event: 'payment_recovery_checked',
      metadata: { intentId: session.intentId, source: 'journey' },
    });

    try {
      const nextSession = await syncLiveStatus(session);
      const nextRecovery = journeyRecovery(nextSession);
      if (
        nextRecovery.bucket === 'issued'
        || nextRecovery.bucket === 'ready_for_dispatch'
        || nextRecovery.bookingState === 'payment_confirmed'
      ) {
        setPaymentRecoveryNote('Payment cleared. Ace is finishing the ticket now.');
      } else if (nextRecovery.bucket === 'awaiting_payment') {
        setPaymentRecoveryNote(
          nextRecovery.holdValue
            ? `Payment has not cleared yet. The route is still held until ${nextRecovery.holdValue}.`
            : 'Payment has not cleared yet. If you already paid, give it a moment and check again.',
        );
      } else {
        setPaymentRecoveryNote('Ace refreshed the journey state. The held route is still intact here.');
      }
    } catch (error: any) {
      const message = error?.message ?? 'Ace could not confirm payment yet. Please try again in a moment.';
      setPaymentRecoveryNote(message);
      setError(message);
    } finally {
      setPaymentCheckLoading(false);
    }
  }, [logJourneyEvent, paymentCheckLoading, session, syncLiveStatus]);

  const openMap = useCallback(async () => {
    if (!session?.toStation) return;
    await Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(session.toStation)}`);
    logJourneyEvent({
      event: 'journey_navigation_opened',
      metadata: { intentId: session.intentId, destination: session.toStation },
    });
  }, [logJourneyEvent, session]);

  const openShare = useCallback(async () => {
    if (!session?.shareToken) return;
    await Linking.openURL(`https://api.agentpay.so/trip/view/${session.shareToken}`);
    logJourneyEvent({
      event: 'journey_share_opened',
      metadata: { intentId: session.intentId },
    });
  }, [logJourneyEvent, session]);

  const askAce = useCallback(() => {
    const prompt = repeatPrompt ?? (routeLabel ? `${routeLabel.replace(' -> ', ' to ')} next available` : undefined);
    if (session) {
      logJourneyEvent({
        event: session.rerouteOfferTranscript ? 'reroute_offer_accepted' : 'journey_reopened_in_ace',
        metadata: {
          intentId: session.intentId,
          source: session.rerouteOfferTranscript ? 'journey_offer' : 'journey',
        },
      });
    }
    router.replace({ pathname: '/(main)/converse', params: prompt ? { prefill: prompt } : undefined } as any);
  }, [logJourneyEvent, repeatPrompt, routeLabel, session]);

  const handleCard = useCallback(async (card: (typeof cards)[number]) => {
    if (['delay_risk', 'connection_risk'].includes(card.kind)) {
      if (session) {
        logJourneyEvent({
          event: 'reroute_offer_accepted',
          metadata: {
            intentId: session.intentId,
            source: 'journey_card',
            cardKind: card.kind,
          },
        });
      }
      askAce();
      return;
    }
    if (['platform_changed', 'gate_changed'].includes(card.kind)) {
      setAcknowledgedSignalIds((current) => (
        current.includes(card.id) ? current : [...current, card.id]
      ));
      if (session) {
        logJourneyEvent({
          event: 'journey_signal_acknowledged',
          metadata: {
            intentId: session.intentId,
            source: 'journey_card',
            cardKind: card.kind,
          },
        });
      }
      return;
    }
    if (card.kind === 'destination_suggestion' || card.kind === 'leave_now') {
      await openMap();
    }
  }, [askAce, logJourneyEvent, openMap, session]);

  const openIssueModal = useCallback((category?: 'payment' | 'delay' | 'ticket' | 'other') => {
    const nextCategory =
      category
      ?? (session?.state === 'payment_pending' ? 'payment'
      : session?.state === 'attention' ? 'delay'
      : 'ticket');
    setIssueCategory(nextCategory);
    setIssueSent(false);
    setIssueText((current) => {
      if (current.trim()) return current;
      if (nextCategory === 'payment') return 'Payment did not clear or the payment flow did not complete.';
      if (nextCategory === 'delay') return 'Something changed on this journey and I need help with the next step.';
      if (nextCategory === 'ticket') return 'I need help with the issued ticket or booking details.';
      return '';
    });
    setShowIssueModal(true);
    if (session) {
      logJourneyEvent({
        event: 'support_opened',
        metadata: { intentId: session.intentId, category: nextCategory },
      });
    }
  }, [logJourneyEvent, session]);

  const submitIssue = useCallback(async () => {
    if (!session?.intentId || !agentId || issueSending) return;
    setIssueSending(true);
    try {
      const route = [session.fromStation, session.toStation].filter(Boolean).join(' -> ');
      const prefix = `[${issueCategory}]`;
      const summary = [prefix, route, session.bookingRef ? `ref ${session.bookingRef}` : null].filter(Boolean).join(' ');
      const userText = issueText.trim() || 'Customer requested help from the live journey screen.';
      await reportIssue({
        intentId: session.intentId,
        bookingRef: session.bookingRef ?? null,
        description: `${summary}\n${userText}`,
        hirerId: agentId,
      });
      const requestedAt = new Date().toISOString();
      const nextSession: JourneySession = {
        ...session,
        supportState: 'requested',
        supportRequestedAt: requestedAt,
        supportSummary: userText,
        lastEventKey: 'support_requested',
        lastEventAt: requestedAt,
        updatedAt: requestedAt,
      };
      setSession(nextSession);
      await patchJourneySession(session.intentId, nextSession).catch(() => null);
      logJourneyEvent({
        event: 'support_requested',
        metadata: { intentId: session.intentId, category: issueCategory },
      });
      setIssueSent(true);
      setIssueText('');
    } catch (error: any) {
      logJourneyEvent({
        event: 'support_request_failed',
        severity: 'warning',
        message: error?.message ?? 'Could not send support request from Journey.',
        metadata: { intentId: session.intentId, category: issueCategory },
      });
      setError(error?.message ?? 'Ace could not send your issue right now.');
    } finally {
      setIssueSending(false);
    }
  }, [agentId, issueCategory, issueSending, issueText, logJourneyEvent, session]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color="#93c5fd" style={{ marginTop: 120 }} />
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Journey not ready</Text>
          <Text style={styles.emptyBody}>{error ?? 'Ace could not find this journey yet.'}</Text>
          <Pressable onPress={() => router.replace('/(main)/converse')} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Back to Ace</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={C.textMuted} />
          </Pressable>
          <View style={styles.headerActions}>
            <Pressable onPress={() => { void (session ? syncLiveStatus(session) : refreshSession()); }} hitSlop={12}>
              <Ionicons name="refresh-outline" size={18} color="#7f95aa" />
            </Pressable>
            <View style={[styles.statePill, { backgroundColor: tone?.bg, borderColor: tone?.border }]}>
              <Text style={[styles.statePillText, { color: tone?.text }]}>{journeyStatusLabel(session)}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.routeTitle}>{routeLabel}</Text>
        <Text style={styles.routeBody}>{recovery?.trustLine ?? journeyTrustLine(session)}</Text>

        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroEyebrowWrap}>
              <Text style={styles.heroEyebrow}>{liveHeadline}</Text>
              <Text style={styles.heroTitle}>{session.finalLegSummary || recovery?.etaLine || journeyEtaLine(session)}</Text>
            </View>
            <View style={styles.heroMarkWrap}>
              <AceMark size={54} ringColor="#dcecff" glowColor="#cbe8ff" backgroundColor="transparent" iconColor="#f5fbff" />
            </View>
          </View>

          <View style={styles.summaryGrid}>
            <SummaryPill label="Departs" value={session.departureTime ?? 'TBD'} />
            <SummaryPill label="Countdown" value={departureCountdown ?? 'Watching'} />
            <SummaryPill label="Platform" value={session.platform ?? 'TBD'} />
            <SummaryPill label="Operator" value={session.operator ?? 'Live lookup'} />
            {session.fiatAmount != null && session.currencySymbol && (
              <SummaryPill
                label={recovery?.priceLabel ?? (session.state === 'payment_pending' ? 'Held fare' : 'Price')}
                value={`${session.currencySymbol}${session.fiatAmount.toFixed(2)}`}
              />
            )}
            {recovery?.holdLabel && recovery.holdValue && (
              <SummaryPill label={recovery.holdLabel} value={recovery.holdValue} />
            )}
            <SummaryPill
              label="Reference"
              value={session.bookingRef ?? (recovery?.bucket === 'awaiting_payment' ? 'After payment' : 'Not issued')}
              mono
            />
          </View>
        </View>

        <View style={styles.section}>
          {isAwaitingPayment ? (
            <>
              <Text style={styles.sectionEyebrow}>Payment hold</Text>
              <View style={styles.paymentCard}>
                <Text style={styles.paymentTitle}>{recovery?.headline ?? 'Payment is the only open step'}</Text>
                <Text style={styles.paymentBody}>{paymentRecoveryNote ?? recovery?.etaLine ?? 'Ace is keeping the route warm while payment clears.'}</Text>
                <View style={styles.paymentMetaRow}>
                  {priceValue && (
                    <View style={styles.paymentMetaPill}>
                      <Text style={styles.paymentMetaLabel}>{recovery?.priceLabel ?? 'Held fare'}</Text>
                      <Text style={styles.paymentMetaValue}>{priceValue}</Text>
                    </View>
                  )}
                  {recovery?.holdLabel && recovery.holdValue && (
                    <View style={styles.paymentMetaPill}>
                      <Text style={styles.paymentMetaLabel}>{recovery.holdLabel}</Text>
                      <Text style={styles.paymentMetaValue}>{recovery.holdValue}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.paymentActions}>
                  <Pressable onPress={() => { void openPaymentFlow(); }} style={styles.paymentPrimaryBtn}>
                    <Text style={styles.paymentPrimaryText}>{payLoading ? 'Opening payment...' : 'Complete payment'}</Text>
                  </Pressable>
                  <Pressable onPress={() => { void checkPaymentNow(); }} style={styles.paymentSecondaryBtn}>
                    <Text style={styles.paymentSecondaryText}>{paymentCheckLoading ? 'Checking...' : 'Check payment'}</Text>
                  </Pressable>
                </View>
              </View>
            </>
          ) : showLiveCountdown ? (
            <>
              <Text style={styles.sectionEyebrow}>Live journey</Text>
              <View style={styles.liveStrip}>
                <Text style={styles.liveStripTitle}>
                  {[
                    departureCountdown ? (departureCountdown === 'Now' ? 'Departs now' : `Departs ${departureCountdown.toLowerCase()}`) : null,
                    session.platform ? `Platform ${session.platform}` : null,
                    session.toStation ?? null,
                  ].filter(Boolean).join(' | ')}
                </Text>
                <Text style={styles.liveStripBody}>
                  {session.operator ?? 'Live operator'}{session.departureTime ? ` | ${session.departureTime}` : ''}{session.bookingRef ? ` | Ref ${session.bookingRef}` : ''}
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.sectionEyebrow}>Live handling</Text>
              <View style={styles.stepsCard}>
                {steps.map((step) => (
                  <View key={step.key} style={styles.stepRow}>
                    <View
                      style={[
                        styles.stepDot,
                        step.state === 'done' && styles.stepDotDone,
                        step.state === 'current' && styles.stepDotCurrent,
                      ]}
                    />
                    <View style={styles.stepCopy}>
                      <Text style={[styles.stepTitle, step.state === 'upcoming' && styles.stepTitleMuted]}>{step.label}</Text>
                      <Text style={styles.stepBody}>{step.detail}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>

        {insights.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionEyebrow}>Live signals</Text>
            <View style={styles.cardsWrap}>
              {insights.map((insight) => (
                <InsightCard key={insight.key} insight={insight} />
              ))}
            </View>
          </View>
        )}

        {visibleCards.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionEyebrow}>Actions Ace can take now</Text>
            <View style={styles.cardsWrap}>
              {visibleCards.slice(0, 3).map((card) => {
                const accent = card.severity === 'warning' ? '#f59e0b' : card.severity === 'success' ? '#4ade80' : '#60a5fa';
                const cta = journeyProactiveActionLabel(card);
                return (
                  <View key={card.id} style={[styles.card, { borderColor: `${accent}33` }]}>
                    <View style={[styles.cardDot, { backgroundColor: accent }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{card.title}</Text>
                      <Text style={styles.cardBody}>{card.body}</Text>
                      {cta && (
                        <Pressable onPress={() => { void handleCard(card); }} style={styles.cardBtn}>
                          <Text style={styles.cardBtnText}>{cta}</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {legs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionEyebrow}>Trip timeline</Text>
            <View style={styles.timelineCard}>
              {legs.map((leg, index) => (
                <View key={leg.id ?? `${leg.mode}-${index}`} style={styles.timelineRow}>
                  <View
                    style={[
                      styles.timelineDot,
                      (leg.status === 'completed' || leg.status === 'booked') && styles.timelineDotDone,
                      leg.status === 'attention' && styles.timelineDotWarn,
                    ]}
                  />
                  <View style={styles.timelineCopy}>
                    <Text style={styles.timelineTitle}>{`Leg ${index + 1} | ${leg.label ?? leg.operator ?? leg.mode}`}</Text>
                    <Text style={styles.timelineBody}>
                      {[leg.origin, leg.destination].filter(Boolean).join(' -> ') || 'Journey leg'}
                    </Text>
                    {(leg.departureTime || leg.arrivalTime) && (
                      <Text style={styles.timelineMeta}>
                        {[leg.departureTime ? `Dep ${leg.departureTime}` : null, leg.arrivalTime ? `Arr ${leg.arrivalTime}` : null]
                          .filter(Boolean)
                          .join(' | ')}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {(session.supportState === 'requested' || session.state === 'attention' || session.state === 'payment_pending' || recovery?.shouldEscalate) && (
          <View style={styles.section}>
            <Text style={styles.sectionEyebrow}>Support</Text>
            <View style={styles.supportCard}>
              <Text style={styles.supportTitle}>
                {session.supportState === 'requested' ? 'Support is already on this trip' : 'Need a human on this journey?'}
              </Text>
              <Text style={styles.supportBody}>
                {session.supportState === 'requested'
                  ? (session.supportSummary
                    ? `Latest note sent: ${session.supportSummary}`
                    : 'Ace support already has the route, booking, and live journey context attached.')
                  : recovery?.supportBody ?? 'Ace can hand this straight to support with the live trip context, booking state, and latest changes attached.'}
              </Text>
              <View style={styles.supportActions}>
                <Pressable onPress={() => openIssueModal()} style={styles.supportPrimaryBtn}>
                  <Text style={styles.supportPrimaryText}>{session.supportState === 'requested' ? 'Update support' : 'Get help'}</Text>
                </Pressable>
                {recovery?.bucket === 'awaiting_payment' ? (
                  <Pressable onPress={() => { void checkPaymentNow(); }} style={styles.supportSecondaryBtn}>
                    <Text style={styles.supportSecondaryText}>{paymentCheckLoading ? 'Checking...' : 'Check payment'}</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={openStatus} style={styles.supportSecondaryBtn}>
                    <Text style={styles.supportSecondaryText}>Open live handling</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        )}

        <View style={styles.actions}>
          {isAwaitingPayment ? (
            <Pressable onPress={() => { void openPaymentFlow(); }} style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>{payLoading ? 'Opening payment...' : 'Complete payment'}</Text>
            </Pressable>
          ) : session.state === 'securing' || session.state === 'attention' ? (
            <Pressable onPress={openStatus} style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>Open live handling</Text>
            </Pressable>
          ) : (
            <Pressable onPress={openReceipt} style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>Open receipt</Text>
            </Pressable>
          )}

          <View style={styles.secondaryGrid}>
            {isAwaitingPayment && (
              <Pressable onPress={() => { void checkPaymentNow(); }} style={styles.secondaryBtn}>
                <Ionicons name="refresh-outline" size={16} color="#cbe8ff" />
                <Text style={styles.secondaryBtnText}>{paymentCheckLoading ? 'Checking...' : 'Check payment'}</Text>
              </Pressable>
            )}

            {session.walletPassUrl && (
              <Pressable onPress={() => { void openWallet(); }} style={styles.secondaryBtn}>
                <Ionicons name="wallet-outline" size={16} color="#cbe8ff" />
                <Text style={styles.secondaryBtnText}>{session.walletLastOpenedAt ? 'Open Wallet' : 'Add to Wallet'}</Text>
              </Pressable>
            )}

            {session.toStation && (
              <Pressable onPress={() => { void openMap(); }} style={styles.secondaryBtn}>
                <Ionicons name="navigate-outline" size={16} color="#cbe8ff" />
                <Text style={styles.secondaryBtnText}>Navigate</Text>
              </Pressable>
            )}

            {session.shareToken && (
              <Pressable onPress={() => { void openShare(); }} style={styles.secondaryBtn}>
                <Ionicons name="people-outline" size={16} color="#cbe8ff" />
                <Text style={styles.secondaryBtnText}>Live share</Text>
              </Pressable>
            )}

            <Pressable onPress={askAce} style={styles.secondaryBtn}>
              <Ionicons name="sparkles-outline" size={16} color="#cbe8ff" />
              <Text style={styles.secondaryBtnText}>Ask Ace</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <Modal visible={showIssueModal} transparent animationType="fade" onRequestClose={() => setShowIssueModal(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.issueModal}>
            <Text style={styles.issueTitle}>Get help on this journey</Text>
            <Text style={styles.issueBody}>
              Ace support receives the live route, booking reference, and journey state automatically from here.
            </Text>
            <View style={styles.issueChips}>
              {(['payment', 'delay', 'ticket', 'other'] as const).map((category) => (
                <Pressable
                  key={category}
                  onPress={() => setIssueCategory(category)}
                  style={[styles.issueChip, issueCategory === category && styles.issueChipActive]}
                >
                  <Text style={[styles.issueChipText, issueCategory === category && styles.issueChipTextActive]}>
                    {category === 'payment' ? 'Payment' : category === 'delay' ? 'Delay' : category === 'ticket' ? 'Ticket' : 'Other'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={issueText}
              onChangeText={setIssueText}
              placeholder="What does Ace need to fix?"
              placeholderTextColor="#64748b"
              multiline
              style={styles.issueInput}
            />
            {issueSent && <Text style={styles.issueSent}>Sent. Ace support now has this live journey context.</Text>}
            <View style={styles.issueActions}>
              <Pressable onPress={() => setShowIssueModal(false)} style={styles.issueCancelBtn}>
                <Text style={styles.issueCancelText}>Close</Text>
              </Pressable>
              <Pressable onPress={() => { void submitIssue(); }} style={styles.issueSendBtn}>
                <Text style={styles.issueSendText}>{issueSending ? 'Sending...' : 'Send issue'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SummaryPill({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.summaryPill}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, mono && styles.summaryValueMono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function InsightCard({ insight }: { insight: ReturnType<typeof journeyInsights>[number] }) {
  const toneStyles = insight.tone === 'warning'
    ? { bg: 'rgba(69, 26, 3, 0.55)', border: 'rgba(180, 83, 9, 0.5)', dot: '#f59e0b' }
    : insight.tone === 'success'
    ? { bg: 'rgba(5, 46, 22, 0.55)', border: 'rgba(22, 101, 52, 0.5)', dot: '#4ade80' }
    : insight.tone === 'info'
    ? { bg: 'rgba(8, 47, 73, 0.5)', border: 'rgba(14, 116, 144, 0.45)', dot: '#60a5fa' }
    : { bg: 'rgba(11, 18, 32, 0.92)', border: 'rgba(51, 65, 85, 0.7)', dot: '#94a3b8' };

  return (
    <View style={[styles.insightCard, { backgroundColor: toneStyles.bg, borderColor: toneStyles.border }]}>
      <View style={[styles.insightDot, { backgroundColor: toneStyles.dot }]} />
      <View style={styles.insightCopy}>
        <Text style={styles.insightTitle}>{insight.title}</Text>
        <Text style={styles.insightBody}>{insight.body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080808' },
  container: { padding: 24, paddingBottom: 80 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statePill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
  },
  statePillText: { fontSize: 12, fontWeight: '700' },
  routeTitle: { fontSize: 30, lineHeight: 36, letterSpacing: -0.8, color: '#f8fafc', fontWeight: '700', marginBottom: 10 },
  routeBody: { fontSize: 15, lineHeight: 22, color: '#8ea1b4', marginBottom: 20 },
  heroCard: {
    backgroundColor: 'rgba(6, 13, 24, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(53, 83, 122, 0.42)',
    borderRadius: 26,
    padding: 20,
    marginBottom: 20,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  heroEyebrowWrap: { flex: 1, gap: 6 },
  heroEyebrow: { fontSize: 11, color: '#cbd5e1', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.1 },
  heroTitle: { fontSize: 18, lineHeight: 25, color: '#eef6ff', fontWeight: '700' },
  heroMarkWrap: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryPill: {
    width: '47%',
    backgroundColor: 'rgba(11, 18, 32, 0.94)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 6,
  },
  summaryLabel: { fontSize: 10, color: '#7f95aa', textTransform: 'uppercase', letterSpacing: 0.9, fontWeight: '700' },
  summaryValue: { fontSize: 14, color: '#dcecff', fontWeight: '600' },
  summaryValueMono: { fontFamily: 'monospace', fontSize: 12 },
  section: { marginBottom: 20 },
  sectionEyebrow: { fontSize: 11, color: '#9db1c5', textTransform: 'uppercase', letterSpacing: 1, fontWeight: '700', marginBottom: 10 },
  stepsCard: {
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  stepRow: { flexDirection: 'row', gap: 12 },
  stepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 3,
    borderWidth: 1.5,
    borderColor: '#475569',
    backgroundColor: '#0f172a',
  },
  stepDotDone: { borderColor: '#22c55e', backgroundColor: '#22c55e' },
  stepDotCurrent: { borderColor: '#60a5fa', backgroundColor: '#60a5fa' },
  stepCopy: { flex: 1 },
  stepTitle: { fontSize: 13, color: '#e2e8f0', fontWeight: '700', marginBottom: 2 },
  stepTitleMuted: { color: '#94a3b8' },
  stepBody: { fontSize: 12, lineHeight: 18, color: '#94a3b8' },
  liveStrip: {
    backgroundColor: 'rgba(8, 18, 34, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.18)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 6,
  },
  liveStripTitle: { fontSize: 19, lineHeight: 24, fontWeight: '700', color: '#edf6ff' },
  liveStripBody: { fontSize: 13, lineHeight: 18, color: '#8fb0cb' },
  paymentCard: {
    backgroundColor: 'rgba(8, 18, 34, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.28)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  paymentTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700', color: '#edf6ff' },
  paymentBody: { fontSize: 13, lineHeight: 19, color: '#9fb7cf' },
  paymentMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  paymentMetaPill: {
    minWidth: 132,
    backgroundColor: 'rgba(11, 18, 32, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.7)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 5,
  },
  paymentMetaLabel: { fontSize: 10, color: '#7f95aa', textTransform: 'uppercase', letterSpacing: 0.9, fontWeight: '700' },
  paymentMetaValue: { fontSize: 14, color: '#dcecff', fontWeight: '700' },
  paymentActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  paymentPrimaryBtn: {
    borderRadius: 12,
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  paymentPrimaryText: { fontSize: 13, fontWeight: '700', color: '#eff6ff' },
  paymentSecondaryBtn: {
    borderRadius: 12,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#315b86',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  paymentSecondaryText: { fontSize: 13, fontWeight: '600', color: '#cbe8ff' },
  cardsWrap: { gap: 10 },
  insightCard: {
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  insightDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  insightCopy: { flex: 1 },
  insightTitle: { fontSize: 13, color: '#f8fafc', fontWeight: '700', marginBottom: 3 },
  insightBody: { fontSize: 12, color: '#9fb0c2', lineHeight: 18 },
  card: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  cardTitle: { fontSize: 13, color: '#f8fafc', fontWeight: '700', marginBottom: 3 },
  cardBody: { fontSize: 12, color: '#93a4b8', lineHeight: 18 },
  cardBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderRadius: 999,
    backgroundColor: '#111c2a',
    borderWidth: 1,
    borderColor: '#1e3a5f',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  cardBtnText: { fontSize: 12, fontWeight: '700', color: '#cbe8ff' },
  timelineCard: {
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
    backgroundColor: '#60a5fa',
  },
  timelineDotDone: { backgroundColor: '#4ade80' },
  timelineDotWarn: { backgroundColor: '#f59e0b' },
  timelineCopy: { flex: 1 },
  timelineTitle: { fontSize: 13, color: '#e2e8f0', fontWeight: '700', marginBottom: 2 },
  timelineBody: { fontSize: 12, color: '#94a3b8', lineHeight: 18 },
  timelineMeta: { fontSize: 11, color: '#6b7280', marginTop: 3 },
  supportCard: {
    backgroundColor: 'rgba(11, 18, 32, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(53, 83, 122, 0.34)',
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  supportTitle: { fontSize: 15, fontWeight: '700', color: '#eef6ff' },
  supportBody: { fontSize: 12.5, lineHeight: 19, color: '#9fb0c2' },
  supportActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  supportPrimaryBtn: {
    borderRadius: 12,
    backgroundColor: '#15314f',
    borderWidth: 1,
    borderColor: '#315b86',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  supportPrimaryText: { fontSize: 13, fontWeight: '700', color: '#dcecff' },
  supportSecondaryBtn: {
    borderRadius: 12,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  supportSecondaryText: { fontSize: 13, fontWeight: '600', color: '#cbd5e1' },
  actions: { gap: 10 },
  primaryBtn: {
    backgroundColor: '#1d4ed8',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: '#eff6ff' },
  secondaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  secondaryBtn: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
    paddingVertical: 13,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600', color: '#cbe8ff' },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#f8fafc', marginBottom: 10 },
  emptyBody: { fontSize: 14, lineHeight: 20, color: '#7f95aa', textAlign: 'center', marginBottom: 24 },
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  issueModal: {
    width: '100%',
    borderRadius: 18,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 18,
  },
  issueTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#f8fafc',
    marginBottom: 8,
  },
  issueBody: {
    fontSize: 13,
    lineHeight: 20,
    color: '#94a3b8',
    marginBottom: 14,
  },
  issueChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  issueChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#0f172a',
  },
  issueChipActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#082f49',
  },
  issueChipText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  issueChipTextActive: {
    color: '#bae6fd',
  },
  issueInput: {
    minHeight: 108,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 12,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  issueSent: {
    fontSize: 12,
    color: '#4ade80',
    marginBottom: 10,
  },
  issueActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  issueCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  issueCancelText: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '600',
  },
  issueSendBtn: {
    borderRadius: 12,
    backgroundColor: '#082f49',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  issueSendText: {
    fontSize: 13,
    color: '#bae6fd',
    fontWeight: '700',
  },
});
