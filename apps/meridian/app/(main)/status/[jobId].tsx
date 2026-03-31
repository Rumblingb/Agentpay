/**
 * Status screen — ambient job tracking
 *
 * No technical plumbing visible. Just the orb, narration, and a
 * "Done — view receipt" CTA when the job completes.
 * Polls every 3s via GET /api/v1/payment-intents/:jobId.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Share,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import * as Linking from 'expo-linking';
import { getIntentStatus, createCheckoutSession, createUpiPaymentLink, reportIssue } from '../../../lib/api';
import { saveActiveTrip, saveJourneySession } from '../../../lib/storage';
import { requestNotificationPermission, scheduleProactiveRerouteReminder } from '../../../lib/notifications';
import { useStore } from '../../../lib/store';
import { speak } from '../../../lib/tts';
import { statusNarration } from '../../../lib/concierge';
import { inferJourneyWalletUrl, journeySteps } from '../../../lib/journeySession';
import { C } from '../../../lib/theme';
import { parseTripContext, paymentConfirmedFromMetadata, syncTripBookingState, tripCards, updateTripContext, type ProactiveCard, type TripContext } from '../../../lib/trip';

const POLL_MS = 3000;

type StatusPhase = 'executing' | 'done' | 'error';

function activeLegIndex(legs: Array<{ status?: string }>): number {
  const active = legs.findIndex((leg) => !['completed', 'confirmed', 'verified', 'booked'].includes(String(leg.status ?? '')));
  return active >= 0 ? active : Math.max(0, legs.length - 1);
}

function recoveryPrompt(params: {
  fromStation?: string | null;
  toStation?: string | null;
  bookingRef?: string | null;
  reason: 'delay' | 'payment' | 'problem';
}) {
  const route = [params.fromStation, params.toStation].filter(Boolean).join(' to ');
  if (params.reason === 'delay' && route) return `${route} next available`;
  if (params.reason === 'payment' && route) return `Help me finish paying for ${route}`;
  if (route) return `Help with my booking ${route}`;
  if (params.bookingRef) return `Help with booking ${params.bookingRef}`;
  return 'Help with my current booking';
}

function isRollbackState(bookingState: TripContext['watchState'] extends infer T ? T extends { bookingState?: infer B } ? B : never : never, totalLegs: number) {
  return totalLegs > 1 && (bookingState === 'failed' || bookingState === 'refunded');
}

export default function StatusScreen() {
  const { jobId, intentId, fiatAmount, currencySymbol: paramSymbol, currencyCode: paramCode, tripContext: tripContextParam, shareToken: paramShareToken, journeyId: paramJourneyId, totalLegs: paramTotalLegs } =
    useLocalSearchParams<{ jobId: string; intentId?: string; fiatAmount?: string; currencySymbol?: string; currencyCode?: string; tripContext?: string; shareToken?: string; journeyId?: string; totalLegs?: string }>();
  const totalLegs = paramTotalLegs ? Number(paramTotalLegs) : 1;
  const paymentRequired = !!(fiatAmount && parseFloat(fiatAmount) > 0);
  const { currentAgent, setPhase, agentId } = useStore();

  const [statusPhase, setStatusPhase]   = useState<StatusPhase>('executing');
  const [elapsed, setElapsed]           = useState(0);
  const [errorMsg, setErrorMsg]         = useState<string | null>(null);
  const [bookingRef, setBookingRef]     = useState<string | null>(null);
  const [departureTime, setDepartureTime] = useState<string | null>(null);
  const [platform, setPlatform]         = useState<string | null>(null);
  const [operator, setOperator]         = useState<string | null>(null);
  const [fromStation, setFromStation]   = useState<string | null>(null);
  const [toStation, setToStation]       = useState<string | null>(null);
  const [finalLegSummary, setFinalLegSummary]       = useState<string | null>(null);
  const [departureDatetime, setDepartureDatetime]   = useState<string | null>(null);
  const [flightData, setFlightData]                 = useState<string | null>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [payLoading, setPayLoading]           = useState(false);
  const [paymentCheckLoading, setPaymentCheckLoading] = useState(false);
  const [paymentRecoveryNote, setPaymentRecoveryNote] = useState<string | null>(null);
  const [tripContext, setTripContext]         = useState<TripContext | null>(() => parseTripContext(tripContextParam));
  const [shareToken, setShareToken]           = useState<string | null>(paramShareToken ?? null);
  const [resolvedIntentId, setResolvedIntentId] = useState<string>(intentId ?? jobId);
  const [showIssueModal, setShowIssueModal]   = useState(false);
  const [issueCategory, setIssueCategory]     = useState<'payment' | 'delay' | 'ticket' | 'other'>('payment');
  const [issueText, setIssueText]             = useState('');
  const [issueSending, setIssueSending]       = useState(false);
  const [issueSent, setIssueSent]             = useState(false);
  const rerouteReminderScheduledRef           = useRef(false);
  const currentIntentId = resolvedIntentId || intentId || jobId;

  const checkRef    = useRef(false);     // prevent double-narration
  const elapsedRef  = useRef(0);
  const POLL_TIMEOUT_S = 300;            // keep the live journey warm for up to 5 minutes
  const fadeSuccess = useRef(new Animated.Value(0)).current;
  const orbScale    = useRef(new Animated.Value(1)).current;

  // ── Elapsed timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  // ── Status polling ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!jobId) return;
    void saveActiveTrip({
      intentId: currentIntentId,
      jobId,
      journeyId: paramJourneyId ?? null,
      status: 'securing',
      title: tripContext?.title ?? ([fromStation ?? tripContext?.origin, toStation ?? tripContext?.destination].filter(Boolean).join(' → ') || 'Journey'),
      fromStation: fromStation ?? tripContext?.origin ?? null,
      toStation: toStation ?? tripContext?.destination ?? null,
      departureTime: departureTime ?? tripContext?.departureTime ?? null,
      platform: platform ?? null,
      operator: operator ?? tripContext?.operator ?? null,
      finalLegSummary: finalLegSummary ?? tripContext?.finalLegSummary ?? null,
      fiatAmount: fiatAmount ? parseFloat(fiatAmount) : null,
      currencySymbol: paramSymbol ?? null,
      currencyCode: paramCode ?? null,
      tripContext,
      shareToken,
      updatedAt: new Date().toISOString(),
    });
    void saveJourneySession({
      intentId: currentIntentId,
      jobId,
      journeyId: paramJourneyId ?? null,
      title: tripContext?.title ?? ([fromStation ?? tripContext?.origin, toStation ?? tripContext?.destination].filter(Boolean).join(' -> ') || 'Journey'),
      state: 'securing',
      bookingState: tripContext?.watchState?.bookingState ?? 'securing',
      fromStation: fromStation ?? tripContext?.origin ?? null,
      toStation: toStation ?? tripContext?.destination ?? null,
      departureTime: departureTime ?? tripContext?.departureTime ?? null,
      departureDatetime: tripContext?.departureTime ?? null,
      arrivalTime: tripContext?.arrivalTime ?? null,
      platform: platform ?? null,
      operator: operator ?? tripContext?.operator ?? null,
      bookingRef: tripContext?.bookingRef ?? null,
      finalLegSummary: finalLegSummary ?? tripContext?.finalLegSummary ?? null,
      fiatAmount: fiatAmount ? parseFloat(fiatAmount) : null,
      currencySymbol: paramSymbol ?? null,
      currencyCode: paramCode ?? null,
      tripContext,
      shareToken,
      walletPassUrl: inferJourneyWalletUrl(tripContext),
      updatedAt: new Date().toISOString(),
    });
  }, [jobId, currentIntentId, fromStation, toStation, departureTime, platform, operator, finalLegSummary, fiatAmount, paramSymbol, paramCode, tripContext, shareToken, paramJourneyId]);

  useEffect(() => {
    if (statusPhase !== 'executing' || !jobId) return;

    const t = setInterval(async () => {
      try {
        const data = await getIntentStatus(jobId);
        if (data.intentId && data.intentId !== resolvedIntentId) {
          setResolvedIntentId(data.intentId);
        }
        const s = data.status;
        const serverTrip = parseTripContext(data.metadata?.tripContext);
        if (serverTrip) {
          setTripContext(serverTrip);
        }
        if (paymentConfirmedFromMetadata(data.metadata)) {
          setPaymentConfirmed(true);
          if (serverTrip) {
            setTripContext(syncTripBookingState(serverTrip, {
              phase: serverTrip.phase,
              bookingConfirmed: serverTrip.watchState?.bookingConfirmed,
              paymentConfirmed: true,
              paymentRequired,
            }));
          }
        }

        if (s === 'completed' || s === 'confirmed' || s === 'verified') {
          clearInterval(t);
          if (!checkRef.current) {
            checkRef.current = true;
            // Extract booking proof fields
            const proof = data.metadata?.completionProof ?? {};
            const ref = proof.bookingRef ?? null;
            if (ref) setBookingRef(ref);
            if (proof.departureTime) setDepartureTime(proof.departureTime);
            if (proof.platform)      setPlatform(proof.platform);
            if (proof.operator)      setOperator(proof.operator);
            if (proof.fromStation)   setFromStation(proof.fromStation);
            if (proof.toStation)     setToStation(proof.toStation);
            // isSimulated is internal — never surface to users
            if (proof.finalLegSummary)   setFinalLegSummary(proof.finalLegSummary);
            if (proof.departureDatetime) setDepartureDatetime(proof.departureDatetime);
            if (data.metadata?.flightDetails) setFlightData(JSON.stringify(data.metadata.flightDetails));
            // Trip room share token (auto-created for family bookings in Phase 2)
            const resolvedShareToken = data.metadata?.shareToken ?? shareToken ?? null;
            if (resolvedShareToken && resolvedShareToken !== shareToken) setShareToken(resolvedShareToken);
            const paymentWasConfirmed = paymentConfirmedFromMetadata(data.metadata);
            if (paymentWasConfirmed) {
              setPaymentConfirmed(true);
            }
            const nextTripContext = syncTripBookingState(serverTrip ?? tripContext, {
              phase: 'booked',
              bookingConfirmed: true,
              paymentConfirmed: paymentWasConfirmed,
              paymentRequired,
              bookingRef: ref ?? undefined,
              origin: proof.fromStation ?? undefined,
              destination: proof.toStation ?? undefined,
              departureTime: proof.departureDatetime ?? proof.departureTime ?? undefined,
              arrivalTime: proof.arrivalTime ?? undefined,
              operator: proof.operator ?? undefined,
              finalLegSummary: proof.finalLegSummary ?? undefined,
            });
            setTripContext(nextTripContext);
            setStatusPhase('done');
            setPhase('done');
            void saveActiveTrip({
              intentId: data.intentId ?? currentIntentId,
              jobId,
              journeyId: paramJourneyId ?? null,
              status: 'ticketed',
              title: nextTripContext?.title ?? ([proof.fromStation, proof.toStation].filter(Boolean).join(' → ') || 'Journey'),
              fromStation: proof.fromStation ?? null,
              toStation: proof.toStation ?? null,
              departureTime: proof.departureTime ?? null,
              platform: proof.platform ?? null,
              operator: proof.operator ?? null,
              bookingRef: ref,
              finalLegSummary: proof.finalLegSummary ?? null,
              fiatAmount: fiatAmount ? parseFloat(fiatAmount) : null,
              currencySymbol: paramSymbol ?? null,
              currencyCode: paramCode ?? null,
              tripContext: nextTripContext,
              shareToken: resolvedShareToken,
              updatedAt: new Date().toISOString(),
            });
            void saveJourneySession({
              intentId: data.intentId ?? currentIntentId,
              jobId,
              journeyId: paramJourneyId ?? null,
              title: nextTripContext?.title ?? ([proof.fromStation, proof.toStation].filter(Boolean).join(' -> ') || 'Journey'),
              state: paymentWasConfirmed || !paymentRequired ? 'ticketed' : 'payment_pending',
              bookingState: nextTripContext?.watchState?.bookingState ?? 'issued',
              fromStation: proof.fromStation ?? null,
              toStation: proof.toStation ?? null,
              departureTime: proof.departureTime ?? null,
              departureDatetime: proof.departureDatetime ?? proof.departureTime ?? null,
              arrivalTime: proof.arrivalTime ?? null,
              platform: proof.platform ?? null,
              operator: proof.operator ?? null,
              bookingRef: ref,
              finalLegSummary: proof.finalLegSummary ?? null,
              fiatAmount: fiatAmount ? parseFloat(fiatAmount) : null,
              currencySymbol: paramSymbol ?? null,
              currencyCode: paramCode ?? null,
              tripContext: nextTripContext,
              shareToken: resolvedShareToken,
              walletPassUrl: inferJourneyWalletUrl(nextTripContext),
              updatedAt: new Date().toISOString(),
            });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            const doneMsg = ref
              ? `Securing your ticket. Ace reference ${ref.replace(/-/g, ' ')}. Ticket details by email within 15 minutes.`
              : 'Securing your ticket. Ticket details will arrive by email within 15 minutes.';
            await speak(doneMsg);
            // Animate success
            Animated.parallel([
              Animated.spring(orbScale, { toValue: 1.2, useNativeDriver: true, speed: 30 }),
              Animated.timing(fadeSuccess, { toValue: 1, duration: 400, useNativeDriver: true }),
            ]).start(() => {
              Animated.spring(orbScale, { toValue: 1, useNativeDriver: true, speed: 10 }).start();
            });
          }
        } else if (s === 'failed' || s === 'expired' || s === 'rejected') {
          clearInterval(t);
          setStatusPhase('error');
          const errMsg = s === 'expired'
            ? 'The hold expired before ticket issue finished. Ace kept the journey here so you can choose the next clean step.'
            : 'This booking could not finish cleanly. Ace kept the journey context so you can recover without starting over.';
          setErrorMsg(errMsg);
          setPhase('error');
          const attentionTrip = syncTripBookingState(serverTrip ?? tripContext, {
            phase: 'attention',
            paymentRequired,
            failed: true,
          });
          setTripContext(attentionTrip);
          void saveActiveTrip({
            intentId: data.intentId ?? currentIntentId,
            jobId,
            journeyId: paramJourneyId ?? null,
            status: 'attention',
            title: attentionTrip?.title ?? ([fromStation ?? tripContext?.origin, toStation ?? tripContext?.destination].filter(Boolean).join(' → ') || 'Journey'),
            fromStation: fromStation ?? null,
            toStation: toStation ?? null,
            departureTime: departureTime ?? null,
            platform: platform ?? null,
            operator: operator ?? null,
            finalLegSummary: finalLegSummary ?? null,
            fiatAmount: fiatAmount ? parseFloat(fiatAmount) : null,
            currencySymbol: paramSymbol ?? null,
            currencyCode: paramCode ?? null,
            tripContext: attentionTrip,
            shareToken,
            updatedAt: new Date().toISOString(),
          });
          void saveJourneySession({
            intentId: data.intentId ?? currentIntentId,
            jobId,
            journeyId: paramJourneyId ?? null,
            title: attentionTrip?.title ?? ([fromStation ?? tripContext?.origin, toStation ?? tripContext?.destination].filter(Boolean).join(' -> ') || 'Journey'),
            state: 'attention',
            bookingState: attentionTrip?.watchState?.bookingState ?? 'failed',
            fromStation: fromStation ?? null,
            toStation: toStation ?? null,
            departureTime: departureTime ?? null,
            departureDatetime: departureDatetime ?? departureTime ?? null,
            arrivalTime: null,
            platform: platform ?? null,
            operator: operator ?? null,
            bookingRef: bookingRef ?? null,
            finalLegSummary: finalLegSummary ?? null,
            fiatAmount: fiatAmount ? parseFloat(fiatAmount) : null,
            currencySymbol: paramSymbol ?? null,
            currencyCode: paramCode ?? null,
            tripContext: attentionTrip,
            shareToken,
            updatedAt: new Date().toISOString(),
          });
          await speak(errMsg);
        } else if (elapsedRef.current >= POLL_TIMEOUT_S) {
          // Booking confirmation is taking too long — auto-complete may have failed.
          // Show a soft message rather than spinning forever.
          clearInterval(t);
          setStatusPhase('error');
          setErrorMsg('This is taking longer than usual, but Ace is still holding the journey here while the booking settles.');
          setPhase('error');
          const attentionTrip = syncTripBookingState(serverTrip ?? tripContext, {
            phase: 'attention',
            paymentRequired,
            failed: true,
          });
          setTripContext(attentionTrip);
          void saveActiveTrip({
            intentId: currentIntentId,
            jobId,
            journeyId: paramJourneyId ?? null,
            status: 'attention',
            title: attentionTrip?.title ?? ([fromStation ?? tripContext?.origin, toStation ?? tripContext?.destination].filter(Boolean).join(' → ') || 'Journey'),
            fromStation: fromStation ?? null,
            toStation: toStation ?? null,
            departureTime: departureTime ?? null,
            platform: platform ?? null,
            operator: operator ?? null,
            finalLegSummary: finalLegSummary ?? null,
            fiatAmount: fiatAmount ? parseFloat(fiatAmount) : null,
            currencySymbol: paramSymbol ?? null,
            currencyCode: paramCode ?? null,
            tripContext: attentionTrip,
            shareToken,
            updatedAt: new Date().toISOString(),
          });
          void saveJourneySession({
            intentId: currentIntentId,
            jobId,
            journeyId: paramJourneyId ?? null,
            title: attentionTrip?.title ?? ([fromStation ?? tripContext?.origin, toStation ?? tripContext?.destination].filter(Boolean).join(' -> ') || 'Journey'),
            state: 'attention',
            bookingState: attentionTrip?.watchState?.bookingState ?? 'failed',
            fromStation: fromStation ?? null,
            toStation: toStation ?? null,
            departureTime: departureTime ?? null,
            departureDatetime: departureDatetime ?? departureTime ?? null,
            arrivalTime: null,
            platform: platform ?? null,
            operator: operator ?? null,
            bookingRef: bookingRef ?? null,
            finalLegSummary: finalLegSummary ?? null,
            fiatAmount: fiatAmount ? parseFloat(fiatAmount) : null,
            currencySymbol: paramSymbol ?? null,
            currencyCode: paramCode ?? null,
            tripContext: attentionTrip,
            shareToken,
            updatedAt: new Date().toISOString(),
          });
          await speak('This is taking longer than usual, but Ace is still holding the journey here while the booking settles.');
        }
      } catch {
        // transient — keep polling
      }
    }, POLL_MS);

    return () => clearInterval(t);
  }, [statusPhase, jobId, currentIntentId, resolvedIntentId, setPhase, fiatAmount, paramSymbol, paramCode, fromStation, toStation, departureTime, departureDatetime, platform, operator, finalLegSummary, bookingRef, tripContext, paymentRequired, shareToken, paramJourneyId]);

  // ── Payment confirmation poll (runs after job completes, until paid) ──────
  // Times out after 10 minutes — payment confirmed via webhook anyway, user can re-open receipt
  useEffect(() => {
    if (statusPhase !== 'done' || paymentConfirmed || !jobId) return;
    let polls = 0;
    const MAX_POLLS = 200; // 200 × 3s = 600s = 10 min
    const t = setInterval(async () => {
      polls += 1;
      if (polls >= MAX_POLLS) { clearInterval(t); return; }
      try {
        const data = await getIntentStatus(jobId);
        if (paymentConfirmedFromMetadata(data.metadata)) {
          setPaymentConfirmed(true);
          clearInterval(t);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [statusPhase, paymentConfirmed, jobId]);

  useEffect(() => {
    if (!paymentConfirmed || !jobId) return;
    const nextTripContext = syncTripBookingState(tripContext, {
      phase: statusPhase === 'error' ? 'attention' : 'booked',
      bookingConfirmed: true,
      paymentConfirmed: true,
      paymentRequired,
      bookingRef: bookingRef ?? undefined,
      origin: fromStation ?? undefined,
      destination: toStation ?? undefined,
      departureTime: departureDatetime ?? departureTime ?? undefined,
      arrivalTime: undefined,
      operator: operator ?? undefined,
      finalLegSummary: finalLegSummary ?? undefined,
    });
    if (nextTripContext) {
      setTripContext(nextTripContext);
      void saveActiveTrip({
        intentId: currentIntentId,
        jobId,
        journeyId: paramJourneyId ?? null,
        status: isError ? 'attention' : 'ticketed',
        title: nextTripContext.title,
        fromStation: fromStation ?? nextTripContext.origin ?? null,
        toStation: toStation ?? nextTripContext.destination ?? null,
        departureTime: departureTime ?? nextTripContext.departureTime ?? null,
        platform: platform ?? null,
        operator: operator ?? nextTripContext.operator ?? null,
        bookingRef: bookingRef ?? nextTripContext.bookingRef ?? null,
        finalLegSummary: finalLegSummary ?? nextTripContext.finalLegSummary ?? null,
        fiatAmount: fiatAmount ? parseFloat(fiatAmount) : null,
        currencySymbol: paramSymbol ?? null,
        currencyCode: paramCode ?? null,
        tripContext: nextTripContext,
        shareToken,
        updatedAt: new Date().toISOString(),
      });
      void saveJourneySession({
        intentId: currentIntentId,
        jobId,
        journeyId: paramJourneyId ?? null,
        title: nextTripContext.title,
        state: isError ? 'attention' : 'ticketed',
        bookingState: nextTripContext.watchState?.bookingState ?? (isError ? 'failed' : 'issued'),
        fromStation: fromStation ?? nextTripContext.origin ?? null,
        toStation: toStation ?? nextTripContext.destination ?? null,
        departureTime: departureTime ?? nextTripContext.departureTime ?? null,
        departureDatetime: departureDatetime ?? nextTripContext.departureTime ?? null,
        arrivalTime: nextTripContext.arrivalTime ?? null,
        platform: platform ?? null,
        operator: operator ?? nextTripContext.operator ?? null,
        bookingRef: bookingRef ?? nextTripContext.bookingRef ?? null,
        finalLegSummary: finalLegSummary ?? nextTripContext.finalLegSummary ?? null,
        fiatAmount: fiatAmount ? parseFloat(fiatAmount) : null,
        currencySymbol: paramSymbol ?? null,
        currencyCode: paramCode ?? null,
        tripContext: nextTripContext,
        shareToken,
        walletPassUrl: inferJourneyWalletUrl(nextTripContext),
        updatedAt: new Date().toISOString(),
      });
    }
  }, [paymentConfirmed, currentIntentId, jobId, tripContext, statusPhase, bookingRef, fromStation, toStation, departureDatetime, departureTime, operator, finalLegSummary, platform, fiatAmount, paramSymbol, paramCode, shareToken, paymentRequired, paramJourneyId]);

  // ── Periodic narration during execution ───────────────────────────────────
  useEffect(() => {
    if (statusPhase !== 'executing' || !currentAgent) return;
    if (elapsed === 0 || elapsed % 20 !== 0) return;
    speak(statusNarration(currentAgent, elapsed));
  }, [elapsed, statusPhase, currentAgent]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const isDone       = statusPhase === 'done';
  const isError      = statusPhase === 'error';
  // Only show full green success once payment is confirmed (or no payment needed)
  const needsPayment = isDone && fiatAmount && parseFloat(fiatAmount) > 0;
  const isFullyDone  = isDone && (!needsPayment || paymentConfirmed);
  const bookingState = tripContext?.watchState?.bookingState;
  const rolledBackJourney = isRollbackState(bookingState, totalLegs);
  const cards = tripCards(tripContext);
  const currentLegIndex = activeLegIndex((tripContext as any)?.legs ?? []);
  const journeyState =
    isError ? 'attention'
    : isFullyDone ? 'ticketed'
    : isDone && needsPayment && !paymentConfirmed ? 'payment_pending'
    : tripContext?.phase === 'in_transit' ? 'in_transit'
    : tripContext?.phase === 'arriving' || tripContext?.phase === 'arrived' ? 'arriving'
    : 'securing';
  const conciergeSteps = journeySteps({
    intentId: currentIntentId,
    jobId,
    title: tripContext?.title ?? ([fromStation, toStation].filter(Boolean).join(' -> ') || 'Journey'),
    state: journeyState,
    bookingState: tripContext?.watchState?.bookingState ?? null,
    tripContext,
    updatedAt: new Date().toISOString(),
  } as any);
  const conciergeHeadline =
    isError ? 'This journey needs intervention'
    : isFullyDone ? 'Your journey is locked in'
    : isDone && needsPayment && !paymentConfirmed ? 'Everything is lined up for payment'
    : 'Ace is handling the booking now';
  const conciergeSubline =
    isError ? 'Ace still has the trip, but something changed before it was safe to lock in.'
    : isFullyDone ? 'Booking, payment, and ticketing are aligned.'
    : isDone && needsPayment && !paymentConfirmed ? 'Ace has done the booking work. Paying now lets it finish the ticket issue cleanly.'
    : 'Ace is working through the live booking steps for you now.';
  const conciergeEta =
    isError ? 'Ace kept the journey state intact so you can recover without losing the context.'
    : isFullyDone ? 'Done. Your live trip state is now locked in.'
    : isDone && needsPayment && !paymentConfirmed ? 'The route is being held while payment finishes the last step.'
    : elapsed < 300
    ? 'Most bookings settle inside a few minutes. Ace keeps ownership while this runs.'
    : 'This is taking longer than usual, but Ace is still carrying the booking in the background.';
  const supportPrompt = recoveryPrompt({
    fromStation,
    toStation,
    bookingRef,
    reason: isDone && needsPayment && !paymentConfirmed ? 'payment' : isError ? 'problem' : 'delay',
  });

  const openIssueModal = (category: 'payment' | 'delay' | 'ticket' | 'other') => {
    setIssueCategory(category);
    setIssueSent(false);
    setIssueText((current) => {
      if (current.trim()) return current;
      if (category === 'payment') return 'Payment page did not open or payment did not complete.';
      if (category === 'delay') return 'Journey changed and I need help with the next step.';
      if (category === 'ticket') return 'I have not received the ticket or booking confirmation yet.';
      return '';
    });
    setShowIssueModal(true);
  };

  const submitIssue = async () => {
    if (!agentId || issueSending) return;
    setIssueSending(true);
    try {
      const route = [fromStation, toStation].filter(Boolean).join(' -> ');
      const prefix = `[${issueCategory}]`;
      const summary = [prefix, route, bookingRef ? `ref ${bookingRef}` : null].filter(Boolean).join(' ');
      await reportIssue({
        intentId: currentIntentId,
        bookingRef,
        description: `${summary}\n${issueText.trim() || 'Customer requested help from live booking screen.'}`,
        hirerId: agentId,
      });
      setIssueSent(true);
      setIssueText('');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Could not send your issue right now.');
    } finally {
      setIssueSending(false);
    }
  };

  const openPaymentFlow = async () => {
    if (!jobId || !fiatAmount || payLoading) return;
    setPayLoading(true);
    setPaymentRecoveryNote('Complete payment, then return here. Ace will keep checking automatically.');
    try {
      if ((paramCode ?? 'GBP').toUpperCase() === 'INR') {
        const { shortUrl } = await createUpiPaymentLink({
          jobId,
          journeyId: paramJourneyId,
          amountInr: Math.round(parseFloat(fiatAmount)),
          description: [fromStation, toStation].filter(Boolean).join(' -> ') || 'Ace booking',
        });
        await Linking.openURL(shortUrl);
      } else {
        const { url } = await createCheckoutSession({
          jobId,
          journeyId: paramJourneyId,
          amountFiat: parseFloat(fiatAmount),
          currencyCode: paramCode ?? 'GBP',
          description: [fromStation, toStation].filter(Boolean).join(' → ') || 'Ace booking',
        });
        await Linking.openURL(url);
      }
    } catch (e: any) {
      const message = e?.message ?? 'Could not open payment. Please try again.';
      setErrorMsg(message);
      setPaymentRecoveryNote(message);
    } finally {
      setPayLoading(false);
    }
  };

  const checkPaymentNow = async () => {
    if (!jobId || paymentCheckLoading) return;
    setPaymentCheckLoading(true);
    try {
      const data = await getIntentStatus(jobId);
      const serverTrip = parseTripContext(data.metadata?.tripContext);
      if (serverTrip) {
        setTripContext(serverTrip);
      }
      if (paymentConfirmedFromMetadata(data.metadata)) {
        setPaymentConfirmed(true);
        setPaymentRecoveryNote('Payment cleared. Ace is finishing the journey now.');
        if (serverTrip) {
          setTripContext(syncTripBookingState(serverTrip, {
            phase: serverTrip.phase,
            bookingConfirmed: serverTrip.watchState?.bookingConfirmed,
            paymentConfirmed: true,
            paymentRequired,
          }));
        }
        return;
      }
      setPaymentRecoveryNote('Payment has not cleared yet. If you already paid, give it a moment and check again.');
    } catch (e: any) {
      setPaymentRecoveryNote(e?.message ?? 'Ace could not confirm payment yet. Please try again in a moment.');
    } finally {
      setPaymentCheckLoading(false);
    }
  };

  useEffect(() => {
    const route = [fromStation ?? tripContext?.origin, toStation ?? tripContext?.destination].filter(Boolean).join(' to ');
    const transcriptForRecovery = route ? `${route} next available` : null;
    const shouldNudge =
      !!tripContext?.watchState?.delayRisk
      || !!tripContext?.watchState?.connectionRisk
      || statusPhase === 'error';
    if (!jobId || !route || !transcriptForRecovery || !shouldNudge || rerouteReminderScheduledRef.current) return;
    rerouteReminderScheduledRef.current = true;

    void (async () => {
      const granted = await requestNotificationPermission();
      if (!granted) return;
      await scheduleProactiveRerouteReminder({
        intentId: currentIntentId,
        route,
        reason: tripContext?.watchState?.connectionRisk
          ? 'The connection is getting tight.'
          : statusPhase === 'error'
          ? 'This booking needs a cleaner route.'
          : 'The trip looks delayed.',
        transcript: transcriptForRecovery,
        shareToken,
      });
    })();
  }, [
    jobId,
    fromStation,
    toStation,
    tripContext?.origin,
    tripContext?.destination,
    tripContext?.watchState?.delayRisk,
    tripContext?.watchState?.connectionRisk,
    statusPhase,
    shareToken,
  ]);

  const handleProactiveCardPress = async (card: ProactiveCard) => {
    const route = [fromStation ?? tripContext?.origin, toStation ?? tripContext?.destination].filter(Boolean).join(' to ');
    if (['delay_risk', 'connection_risk', 'platform_changed', 'gate_changed'].includes(card.kind) && route) {
      router.replace({ pathname: '/(main)/converse', params: { prefill: `${route} next available` } } as any);
      return;
    }
    if ((card.kind === 'leave_now' || card.kind === 'destination_suggestion') && (toStation || tripContext?.destination)) {
      const target = encodeURIComponent((toStation ?? tripContext?.destination)!);
      await Linking.openURL(`https://maps.google.com/?q=${target}`);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusAtmosphere />
      <View style={styles.container}>

        {/* Back */}
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={C.textMuted} />
        </Pressable>

        {/* Agent label with emerald indicator */}
        {currentAgent && (
          <View style={styles.agentLabelRow}>
            <View style={styles.agentDot} />
            <Text style={styles.agentLabel}>{currentAgent.name}</Text>
          </View>
        )}

        {/* Main orb visual */}
        <View style={styles.orbWrap}>
          <Animated.View style={{ transform: [{ scale: orbScale }] }}>
            {isFullyDone ? (
              <LinearGradient colors={[C.emDim, C.greenMid]} style={[styles.orb, { shadowColor: C.green }]}>
                <Ionicons name="checkmark" size={52} color={C.green} />
              </LinearGradient>
            ) : isDone && needsPayment && !paymentConfirmed ? (
              <LinearGradient colors={['#451a03', '#92400e']} style={[styles.orb, { shadowColor: '#f59e0b' }]}>
                <Ionicons name="card-outline" size={44} color="#fbbf24" />
              </LinearGradient>
            ) : isError ? (
              <LinearGradient colors={[C.redDim, C.redMid]} style={[styles.orb, { shadowColor: C.red }]}>
                <Ionicons name="warning-outline" size={44} color={C.red} />
              </LinearGradient>
            ) : (
              <OrbWorking />
            )}
          </Animated.View>
        </View>

        {/* Status text */}
        <Text style={styles.statusEyebrow}>Ace is handling the journey</Text>
        <Text style={[styles.statusTitle, isFullyDone && styles.statusTitleDone, isError && styles.statusTitleError,
          isDone && needsPayment && !paymentConfirmed && { color: '#fbbf24' }]}>
          {rolledBackJourney ? 'Journey safely unwound'
            : isFullyDone ? 'Journey secured'
            : isDone && needsPayment && !paymentConfirmed ? 'Ready for payment'
            : isError ? 'Journey paused'
            : 'Ace is on it'}
        </Text>

        <Text style={styles.statusSub}>
          {rolledBackJourney
            ? 'One leg could not be secured, so Ace cancelled the rest to avoid leaving you half-booked.'
            : isFullyDone
            ? totalLegs > 1
              ? `All ${totalLegs} legs booked. Ticket details arrive by email for each leg.`
              : 'Ace has your journey moving. Ticket details arrive by email shortly.'
            : isDone && needsPayment && !paymentConfirmed
            ? 'Your request is in. Tap below to pay and secure your ticket.'
            : isError
            ? (errorMsg ?? 'Something went wrong.')
            : `${currentAgent?.name ?? 'Ace'} is lining everything up | ${elapsed}s`}
        </Text>
        <View style={styles.conciergeCard}>
          <View style={styles.conciergeHeader}>
            <Ionicons name="sparkles-outline" size={14} color="#93c5fd" />
            <Text style={styles.conciergeEyebrow}>Live handling</Text>
          </View>
          <Text style={styles.conciergeHeadline}>{conciergeHeadline}</Text>
          <Text style={styles.conciergeBody}>{conciergeSubline}</Text>
          <View style={styles.conciergeEtaPill}>
            <Ionicons name="time-outline" size={13} color="#cbd5e1" />
            <Text style={styles.conciergeEtaText}>{conciergeEta}</Text>
          </View>
          <View style={styles.conciergeSteps}>
            {conciergeSteps.map((stage, index) => (
              <View key={stage.key} style={styles.conciergeStepRow}>
                <View style={styles.conciergeRail}>
                  <View
                    style={[
                      styles.conciergeDot,
                      stage.state === 'done' && styles.conciergeDotDone,
                      stage.state === 'current' && styles.conciergeDotCurrent,
                    ]}
                  />
                  {index < conciergeSteps.length - 1 && (
                    <View
                      style={[
                        styles.conciergeLine,
                        (stage.state === 'done' || stage.state === 'current') && styles.conciergeLineActive,
                      ]}
                    />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.conciergeStepTitle,
                      stage.state === 'upcoming' && styles.conciergeStepTitleMuted,
                    ]}
                  >
                    {stage.label}
                  </Text>
                  <Text style={styles.conciergeStepBody}>{stage.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
        {totalLegs > 1 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <Ionicons name="git-branch-outline" size={13} color="#818cf8" />
            <Text style={{ fontSize: 12, color: '#818cf8' }}>
              {rolledBackJourney
                ? `${totalLegs}-leg journey | safely cancelled before confirmation`
                : `${totalLegs}-leg journey | Leg ${Math.min(currentLegIndex + 1, totalLegs)} of ${totalLegs}`}
            </Text>
          </View>
        )}
        {rolledBackJourney && (
          <View style={styles.rollbackCard}>
            <Ionicons name="refresh-circle-outline" size={16} color="#93c5fd" />
            <Text style={styles.rollbackText}>
              Ace has already unwound the other legs. You can ask for an alternative now without worrying about a partial booking.
            </Text>
          </View>
        )}

        {/* Multi-leg timeline — shown only for 2+ leg journeys */}
        {(isFullyDone || rolledBackJourney) && (() => {
          const legs: Array<{
            mode?: string;
            operator?: string;
            departureTime?: string;
            origin?: string;
            destination?: string;
            status?: string;
          }> = (tripContext as any)?.legs ?? [];
          if (legs.length <= 1) return null;
          return (
            <View style={legStyles.container}>
              {legs.map((leg, idx) => {
                const legStatus: string = (leg.status ?? 'pending');
                const isDot   = legStatus === 'confirmed' || legStatus === 'completed';
                const isSpinner = legStatus === 'securing' || legStatus === 'pending_payment';
                const isFailed  = legStatus === 'failed';
                const dotColor  = isDot ? '#4ade80' : isSpinner ? '#f59e0b' : isFailed ? '#ef4444' : '#475569';
                const dotSymbol = isDot ? '✓' : isSpinner ? '⟳' : isFailed ? '✗' : '○';

                const modeRaw = (leg.mode ?? '').toLowerCase();
                const modeIcon = modeRaw.includes('flight') || modeRaw.includes('fly')
                  ? '✈'
                  : modeRaw.includes('hotel') || modeRaw.includes('accommodation')
                  ? '🏨'
                  : modeRaw.includes('bus') || modeRaw.includes('coach')
                  ? '🚌'
                  : '🚂';

                const timeStr = leg.departureTime ? ` ${leg.departureTime}` : '';
                const operatorStr = leg.operator ? `${leg.operator}${timeStr}` : timeStr.trim();
                const routeStr = leg.origin && leg.destination
                  ? `${leg.origin} → ${leg.destination}`
                  : leg.destination ?? '';

                return (
                  <View key={idx} style={legStyles.row}>
                    <Text style={legStyles.legNum}>Leg {idx + 1}</Text>
                    <Text style={legStyles.icon}>{modeIcon}</Text>
                    <View style={{ flex: 1 }}>
                      {operatorStr ? <Text style={legStyles.operator}>{operatorStr}</Text> : null}
                      {routeStr ? <Text style={legStyles.route}>{routeStr}</Text> : null}
                    </View>
                    <Text style={[legStyles.dot, { color: dotColor }]}>{dotSymbol}</Text>
                  </View>
                );
              })}

              {/* Share with family — below the timeline, visible when shareToken is set */}
              {shareToken && (
                <Pressable
                  onPress={() => {
                    const url = `https://api.agentpay.so/trip/view/${shareToken}`;
                    void Share.share({
                      title: 'Join my trip on Ace',
                      message: `Track our journey live → ${url}`,
                      url,
                    });
                  }}
                  style={legStyles.shareBtn}
                >
                  <Ionicons name="share-outline" size={15} color="#38bdf8" style={{ marginRight: 6 }} />
                  <Text style={legStyles.shareText}>Share with family</Text>
                </Pressable>
              )}
            </View>
          );
        })()}

        {/* Booking reference pill */}
        {isDone && bookingRef && (
          <View style={styles.bookingRefWrap}>
            <Text style={styles.bookingRefLabel}>Ace Reference</Text>
            <Text style={styles.bookingRef}>{bookingRef}</Text>
            {(departureTime || platform || operator) && (
              <View style={styles.journeyMeta}>
                {departureTime && (
                  <View style={styles.journeyBadge}>
                    <Text style={styles.journeyBadgeText}>🕐 {departureTime}</Text>
                  </View>
                )}
                {platform && (
                  <View style={styles.journeyBadge}>
                    <Text style={styles.journeyBadgeText}>Platform {platform}</Text>
                  </View>
                )}
                {operator && (
                  <Text style={styles.journeyOperator}>{operator}</Text>
                )}
                {finalLegSummary && (
                  <View style={[styles.journeyBadge, { backgroundColor: '#1e1b4b', width: '100%', marginTop: 4 }]}>
                    <Text style={[styles.journeyBadgeText, { color: '#818cf8' }]}>🚇 {finalLegSummary}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Payment button — shown until Stripe payment confirmed */}
        {cards.length > 0 && (
          <View style={styles.proactiveWrap}>
            {cards.slice(0, 2).map((card) => (
              <ProactiveStatusCard key={card.id} card={card} onPress={() => { void handleProactiveCardPress(card); }} />
            ))}
          </View>
        )}

        {isDone && !paymentConfirmed && fiatAmount && parseFloat(fiatAmount) > 0 && (
          <Pressable
            onPress={() => { void openPaymentFlow(); }}
            style={[styles.payBtn, payLoading && { opacity: 0.5 }]}
          >
            <LinearGradient
              colors={['#1e3a5f', '#1d4ed8']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.payBtnGrad}
            >
              <Ionicons name="card-outline" size={20} color="#93c5fd" />
              <Text style={styles.payBtnText}>
                {payLoading ? 'Opening…' : `Pay ${paramSymbol ?? '£'}${parseFloat(fiatAmount).toFixed(2)}`}
              </Text>
            </LinearGradient>
          </Pressable>
        )}

        {isDone && needsPayment && !paymentConfirmed && (
          <View style={styles.paymentRecoveryCard}>
            <View style={styles.paymentRecoveryHeader}>
              <Ionicons name="refresh-outline" size={15} color="#93c5fd" />
              <Text style={styles.paymentRecoveryTitle}>After payment</Text>
            </View>
            <Text style={styles.paymentRecoveryBody}>
              Return here after payment and Ace will keep moving the booking forward.
            </Text>
            {paymentRecoveryNote ? (
              <Text style={styles.paymentRecoveryNote}>{paymentRecoveryNote}</Text>
            ) : null}
            <View style={styles.paymentRecoveryActions}>
              <Pressable
                onPress={() => { void checkPaymentNow(); }}
                style={styles.paymentRecoveryPrimary}
              >
                <Text style={styles.paymentRecoveryPrimaryText}>
                  {paymentCheckLoading ? 'Checking…' : 'I already paid'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => { void openPaymentFlow(); }}
                style={styles.paymentRecoverySecondary}
              >
                <Text style={styles.paymentRecoverySecondaryText}>
                  {payLoading ? 'Opening…' : 'Open payment again'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Payment confirmed badge */}
        {isDone && paymentConfirmed && (
          <View style={styles.paidBadge}>
            <Ionicons name="checkmark-circle" size={16} color="#4ade80" />
            <Text style={styles.paidBadgeText}>Payment confirmed</Text>
          </View>
        )}

        {(isError || (isDone && needsPayment && !paymentConfirmed) || (!isDone && elapsed >= 20)) && (
          <View style={styles.helpRow}>
            <Pressable
              onPress={() => router.replace({ pathname: '/(main)/converse', params: { prefill: supportPrompt } } as any)}
              style={styles.helpPrimaryBtn}
            >
              <Ionicons name="sparkles-outline" size={16} color="#93c5fd" />
              <Text style={styles.helpPrimaryText}>Let Ace sort this</Text>
            </Pressable>
            <Pressable
              onPress={() => openIssueModal(isDone && needsPayment && !paymentConfirmed ? 'payment' : isError ? 'ticket' : 'delay')}
              style={styles.helpSecondaryBtn}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={16} color="#fcd34d" />
              <Text style={styles.helpSecondaryText}>Get help now</Text>
            </Pressable>
          </View>
        )}

        {/* CTA */}
        {isFullyDone && (
          <Animated.View style={[styles.ctaWrap, { opacity: fadeSuccess }]}>
            <Pressable
              onPress={() => {
                const qs = new URLSearchParams();
                if (bookingRef)    qs.set('bookingRef', bookingRef);
                if (departureTime) qs.set('departureTime', departureTime);
                if (platform)      qs.set('platform', platform);
                if (operator)      qs.set('operator', operator);
                if (fromStation)   qs.set('fromStation', fromStation);
                if (toStation)     qs.set('toStation', toStation);
                if (finalLegSummary)   qs.set('finalLegSummary',   finalLegSummary);
                if (departureDatetime) qs.set('departureDatetime', departureDatetime);
                if (flightData)        qs.set('flightData',        flightData);
                if (fiatAmount)  qs.set('fiatAmount',    fiatAmount);
              if (paramSymbol) qs.set('currencySymbol', paramSymbol);
              if (paramCode)   qs.set('currencyCode',   paramCode);
              if (tripContext) qs.set('tripContext', JSON.stringify(tripContext));
              if (shareToken) qs.set('shareToken', shareToken);
              router.push({
                pathname: '/(main)/receipt/[intentId]',
                params: {
                  intentId: currentIntentId,
                  ...Object.fromEntries(qs.entries()),
                },
              });
            }}
              style={styles.receiptBtn}
            >
              <LinearGradient
                colors={['#052e16', '#14532d']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.receiptBtnGrad}
              >
                <Ionicons name="receipt-outline" size={20} color="#4ade80" />
                <Text style={styles.receiptBtnText}>View Receipt</Text>
              </LinearGradient>
            </Pressable>

            {shareToken && (
              <Pressable
                onPress={() => {
                  const url = `https://api.agentpay.so/trip/view/${shareToken}`;
                  void Share.share({
                    title: 'Join my trip on Ace',
                    message: `Track our journey live → ${url}`,
                    url,
                  });
                }}
                style={styles.shareTripBtn}
              >
                <Ionicons name="share-outline" size={16} color={C.sky} style={{ marginRight: 6 }} />
                <Text style={styles.shareTripText}>Share Trip</Text>
              </Pressable>
            )}

            <Pressable
              onPress={() => router.replace('/(main)/converse')}
              style={styles.newRequestBtn}
            >
              <Text style={styles.newRequestText}>New Request</Text>
            </Pressable>
          </Animated.View>
        )}

        {isError && (
          <Pressable
            onPress={() => router.replace('/(main)/converse')}
            style={styles.retryBtn}
          >
            <Text style={styles.retryText}>Try Again</Text>
          </Pressable>
        )}

      </View>

      <Modal visible={showIssueModal} transparent animationType="fade" onRequestClose={() => setShowIssueModal(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.issueModal}>
            <Text style={styles.issueTitle}>Need help with this journey?</Text>
            <Text style={styles.issueBody}>
              Ace support gets the live trip context from this screen automatically, so you do not have to explain everything again.
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
              placeholder="What is going wrong?"
              placeholderTextColor="#64748b"
              multiline
              style={styles.issueInput}
            />
            {issueSent && <Text style={styles.issueSent}>Sent. Ace support now has this journey context.</Text>}
            <View style={styles.issueActions}>
              <Pressable onPress={() => setShowIssueModal(false)} style={styles.issueCancelBtn}>
                <Text style={styles.issueCancelText}>Close</Text>
              </Pressable>
              <Pressable onPress={() => { void submitIssue(); }} style={styles.issueSendBtn}>
                <Text style={styles.issueSendText}>{issueSending ? 'Sending…' : 'Send issue'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/** Animated working orb — extracted to keep the render clean */
function OrbWorking() {
  const ring1 = useRef(new Animated.Value(1)).current;
  const ring1Op = useRef(new Animated.Value(0.5)).current;
  const ring2 = useRef(new Animated.Value(1)).current;
  const ring2Op = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = (s: Animated.Value, o: Animated.Value, delay: number) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(s, { toValue: 1.8, duration: 1500, useNativeDriver: true }),
          Animated.timing(o, { toValue: 0,   duration: 1500, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(s, { toValue: 1,   duration: 0, useNativeDriver: true }),
          Animated.timing(o, { toValue: 0.5, duration: 0, useNativeDriver: true }),
        ]),
      ]));
    loop(ring1, ring1Op, 0).start();
    loop(ring2, ring2Op, 750).start();
  }, []);

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: 140, height: 140 }}>
      <Animated.View style={[statusStyles.ring, { transform: [{ scale: ring1 }], opacity: ring1Op }]} />
      <Animated.View style={[statusStyles.ring, { transform: [{ scale: ring2 }], opacity: ring2Op }]} />
      <LinearGradient colors={[C.emDim, C.emMid]} style={[styles.orb, { shadowColor: C.em }]}>
        <Ionicons name="navigate-outline" size={40} color={C.emBright} />
      </LinearGradient>
    </View>
  );
}

function StatusAtmosphere() {
  return (
    <View pointerEvents="none" style={styles.atmosphere}>
      <LinearGradient
        colors={['rgba(164, 212, 255, 0.16)', 'rgba(164, 212, 255, 0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.atmosphereGlowLeft}
      />
      <LinearGradient
        colors={['rgba(56, 189, 248, 0.12)', 'rgba(99, 102, 241, 0.02)', 'rgba(99, 102, 241, 0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.atmosphereGlowRight}
      />
    </View>
  );
}

const statusStyles = StyleSheet.create({
  ring: {
    position: 'absolute',
    width:  110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1.5,
    borderColor: C.em,
  },
});

function proactiveCardActionLabel(card: ProactiveCard): string | null {
  switch (card.kind) {
    case 'delay_risk':
    case 'connection_risk':
    case 'platform_changed':
    case 'gate_changed':
      return 'Ask Ace to reroute';
    case 'leave_now':
      return 'Navigate';
    case 'destination_suggestion':
      return 'Open map';
    default:
      return card.ctaLabel ?? null;
  }
}

function ProactiveStatusCard({ card, onPress }: { card: ProactiveCard; onPress?: () => void }) {
  const accent = card.severity === 'warning' ? '#f59e0b' : card.severity === 'success' ? '#4ade80' : '#60a5fa';
  const actionLabel = proactiveCardActionLabel(card);
  return (
    <View style={[styles.proactiveCard, { borderColor: `${accent}33` }]}>
      <View style={[styles.proactiveDot, { backgroundColor: accent }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.proactiveTitle}>{card.title}</Text>
        <Text style={styles.proactiveBody}>{card.body}</Text>
        {actionLabel && onPress && (
          <Pressable onPress={onPress} style={styles.proactiveActionBtn}>
            <Text style={styles.proactiveActionText}>{actionLabel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: C.bg },
  atmosphere: {
    ...StyleSheet.absoluteFillObject,
  },
  atmosphereGlowLeft: {
    position: 'absolute',
    top: -50,
    left: -120,
    width: 300,
    height: 300,
    borderRadius: 170,
  },
  atmosphereGlowRight: {
    position: 'absolute',
    top: 80,
    right: -120,
    width: 340,
    height: 340,
    borderRadius: 190,
  },
  container: { flex: 1, paddingHorizontal: 28, alignItems: 'center' },

  back: { alignSelf: 'flex-start', marginTop: 8, marginBottom: 20 },

  agentLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 44,
  },
  agentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.em,
    shadowColor: C.em,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 5,
  },
  agentLabel: {
    fontSize: 12,
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontWeight: '600',
  },

  orbWrap: { marginBottom: 36 },
  orb: {
    width:  120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 36,
    elevation: 14,
  },

  statusEyebrow: {
    fontSize: 11,
    color: '#cbd5e1',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  statusTitle:            { fontSize: 32, fontWeight: '800', color: C.textPrimary, marginBottom: 10, letterSpacing: -0.5 },
  statusTitleDone:        { color: C.green },
  statusTitleRequested:   { color: C.amber },
  statusTitleError:       { color: C.red },

  statusSub: {
    fontSize: 15,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 23,
    marginBottom: 18,
    paddingHorizontal: 16,
  },
  rollbackCard: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(8, 16, 30, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(147, 197, 253, 0.24)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
    marginBottom: 18,
  },
  rollbackText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 19,
    color: '#dbeafe',
  },
  conciergeCard: {
    width: '100%',
    backgroundColor: 'rgba(11, 18, 32, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(53, 83, 122, 0.34)',
    borderRadius: 24,
    padding: 18,
    marginBottom: 18,
    gap: 10,
  },
  conciergeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  conciergeEyebrow: {
    fontSize: 11,
    color: '#93c5fd',
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
  },
  conciergeHeadline: {
    fontSize: 16,
    color: '#f8fafc',
    fontWeight: '800',
  },
  conciergeBody: {
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 19,
  },
  conciergeEtaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  conciergeEtaText: {
    fontSize: 12,
    color: '#cbd5e1',
    fontWeight: '600',
  },
  conciergeSteps: {
    gap: 10,
    paddingTop: 4,
  },
  conciergeStepRow: {
    flexDirection: 'row',
    gap: 10,
  },
  conciergeRail: {
    alignItems: 'center',
    width: 18,
  },
  conciergeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#475569',
    backgroundColor: '#0f172a',
    marginTop: 2,
  },
  conciergeDotDone: {
    borderColor: '#22c55e',
    backgroundColor: '#22c55e',
  },
  conciergeDotCurrent: {
    borderColor: '#60a5fa',
    backgroundColor: '#60a5fa',
  },
  conciergeLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#1e293b',
    marginTop: 4,
    minHeight: 18,
  },
  conciergeLineActive: {
    backgroundColor: '#334155',
  },
  conciergeStepTitle: {
    fontSize: 13,
    color: '#e2e8f0',
    fontWeight: '700',
    marginBottom: 2,
  },
  conciergeStepTitleMuted: {
    color: '#94a3b8',
  },
  conciergeStepBody: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 17,
  },
  proactiveWrap: {
    width: '100%',
    gap: 10,
    marginBottom: 20,
  },
  proactiveCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  proactiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  proactiveTitle: {
    fontSize: 12,
    color: C.textPrimary,
    fontWeight: '700',
    marginBottom: 2,
  },
  proactiveBody: {
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 17,
  },
  proactiveActionBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#0b1320',
    borderWidth: 1,
    borderColor: '#1e3a5f',
  },
  proactiveActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#cbe8ff',
  },

  bookingRefWrap: {
    backgroundColor: '#050f05',
    borderWidth: 1,
    borderColor: C.greenMid,
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 20,
    alignItems: 'center',
    marginBottom: 36,
    width: '100%',
    shadowColor: C.green,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 30,
  },
  bookingRefWrapRequested: {
    backgroundColor: '#0a0700',
    borderColor: C.amberMid,
    shadowColor: C.amber,
  },
  bookingRefLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  bookingRef: {
    fontSize: 28,
    fontWeight: '700',
    color: C.green,
    letterSpacing: 4,
    fontFamily: 'monospace',
  },
  bookingRefRequested: {
    color: C.amber,
    letterSpacing: 2,
  },

  journeyMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
    justifyContent: 'center',
  },
  journeyBadge: {
    backgroundColor: C.emDim,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.emGlow,
  },
  journeyBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: C.emBright,
    letterSpacing: 0.2,
  },
  journeyOperator: {
    width: '100%',
    textAlign: 'center',
    fontSize: 12,
    color: C.textMuted,
    marginTop: 6,
    letterSpacing: 0.3,
  },

  ctaWrap: { width: '100%', alignItems: 'center' },
  receiptBtn: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 14,
    shadowColor: C.em,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  receiptBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
  },
  receiptBtnText: { fontSize: 17, fontWeight: '700', color: C.emBright, letterSpacing: 0.2 },

  newRequestBtn: { paddingVertical: 14 },
  newRequestText: { fontSize: 14, color: C.textMuted, letterSpacing: 0.3 },

  retryBtn: { paddingVertical: 16 },
  retryText: { fontSize: 15, color: C.textSecondary },

  payBtn: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 14,
    shadowColor: '#1d4ed8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  payBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
  },
  payBtnText: { fontSize: 17, fontWeight: '700', color: '#93c5fd', letterSpacing: 0.2 },
  paymentRecoveryCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e3a5f',
    backgroundColor: 'rgba(8, 15, 28, 0.88)',
    padding: 14,
    gap: 10,
    marginBottom: 14,
  },
  paymentRecoveryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  paymentRecoveryTitle: {
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#93c5fd',
    fontWeight: '700',
  },
  paymentRecoveryBody: {
    fontSize: 13,
    lineHeight: 19,
    color: '#cbd5e1',
  },
  paymentRecoveryNote: {
    fontSize: 12,
    lineHeight: 18,
    color: '#94a3b8',
  },
  paymentRecoveryActions: {
    gap: 8,
  },
  paymentRecoveryPrimary: {
    borderRadius: 12,
    backgroundColor: '#1d4ed8',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentRecoveryPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#eff6ff',
  },
  paymentRecoverySecondary: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentRecoverySecondaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#cbd5e1',
  },

  paidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#052e16',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.greenMid,
  },
  paidBadgeText: { fontSize: 13, fontWeight: '600', color: C.green },
  helpRow: {
    width: '100%',
    gap: 10,
    marginBottom: 16,
  },
  helpPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1d4ed8',
    backgroundColor: '#0f172a',
    paddingVertical: 14,
  },
  helpPrimaryText: {
    fontSize: 14,
    color: '#93c5fd',
    fontWeight: '700',
  },
  helpSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#854d0e',
    backgroundColor: '#1c1917',
    paddingVertical: 14,
  },
  helpSecondaryText: {
    fontSize: 14,
    color: '#fcd34d',
    fontWeight: '700',
  },
  shareTripBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#1e293b', marginBottom: 10 },
  shareTripText: { fontSize: 15, color: C.sky, fontWeight: '500' },
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

// ── Leg timeline styles ────────────────────────────────────────────────────────
const legStyles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 20,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legNum: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    width: 36,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  icon: {
    fontSize: 16,
    width: 22,
    textAlign: 'center',
  },
  operator: {
    fontSize: 12,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  route: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 1,
  },
  dot: {
    fontSize: 16,
    fontWeight: '700',
    width: 20,
    textAlign: 'center',
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    marginTop: 4,
  },
  shareText: {
    fontSize: 13,
    color: '#38bdf8',
    fontWeight: '500',
  },
});
