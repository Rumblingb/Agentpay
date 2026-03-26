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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import * as Linking from 'expo-linking';
import { getIntentStatus, createCheckoutSession, createUpiPaymentLink } from '../../../lib/api';
import { saveActiveTrip } from '../../../lib/storage';
import { useStore } from '../../../lib/store';
import { speak } from '../../../lib/tts';
import { statusNarration } from '../../../lib/concierge';
import { C } from '../../../lib/theme';
import { parseTripContext, tripCards, updateTripContext, type ProactiveCard, type TripContext } from '../../../lib/trip';

const POLL_MS = 3000;

type StatusPhase = 'executing' | 'done' | 'error';

export default function StatusScreen() {
  const { jobId, fiatAmount, currencySymbol: paramSymbol, currencyCode: paramCode, tripContext: tripContextParam, shareToken: paramShareToken, journeyId: paramJourneyId, totalLegs: paramTotalLegs } =
    useLocalSearchParams<{ jobId: string; fiatAmount?: string; currencySymbol?: string; currencyCode?: string; tripContext?: string; shareToken?: string; journeyId?: string; totalLegs?: string }>();
  const totalLegs = paramTotalLegs ? Number(paramTotalLegs) : 1;
  const { currentAgent, setPhase } = useStore();

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
  const [tripContext, setTripContext]         = useState<TripContext | null>(() => parseTripContext(tripContextParam));
  const [shareToken, setShareToken]           = useState<string | null>(paramShareToken ?? null);

  const [countdown, setCountdown]       = useState<string | null>(null);
  const spokenRef   = useRef({ t30: false, t10: false, arrived: false });

  const checkRef    = useRef(false);     // prevent double-narration
  const POLL_TIMEOUT_S = 90;             // give up polling after 90s
  const fadeSuccess = useRef(new Animated.Value(0)).current;
  const orbScale    = useRef(new Animated.Value(1)).current;

  // ── Elapsed timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Status polling ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!jobId) return;
    void saveActiveTrip({
      intentId: jobId,
      jobId,
      status: 'securing',
      title: [fromStation, toStation].filter(Boolean).join(' → ') || 'Train journey',
      fromStation: fromStation ?? null,
      toStation: toStation ?? null,
      departureTime: departureTime ?? null,
      platform: platform ?? null,
      operator: operator ?? null,
      finalLegSummary: finalLegSummary ?? null,
      fiatAmount: fiatAmount ? parseFloat(fiatAmount) : null,
      currencySymbol: paramSymbol ?? null,
      currencyCode: paramCode ?? null,
      tripContext,
      shareToken,
      updatedAt: new Date().toISOString(),
    });
  }, [jobId, fromStation, toStation, departureTime, platform, operator, finalLegSummary, fiatAmount, paramSymbol, paramCode, tripContext, shareToken]);

  useEffect(() => {
    if (statusPhase !== 'executing' || !jobId) return;

    const t = setInterval(async () => {
      try {
        const data = await getIntentStatus(jobId);
        const s = data.status;
        const serverTrip = parseTripContext(data.metadata?.tripContext);
        if (serverTrip) {
          setTripContext(serverTrip);
        }
        if (data.metadata?.paymentConfirmed || data.metadata?.stripePaymentConfirmed || data.metadata?.razorpayPaymentConfirmed) {
          setPaymentConfirmed(true);
          if (serverTrip) {
            setTripContext(updateTripContext(serverTrip, serverTrip.phase, {
              watchState: { ...serverTrip.watchState, paymentConfirmed: true },
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
            if (data.metadata?.paymentConfirmed || data.metadata?.stripePaymentConfirmed || data.metadata?.razorpayPaymentConfirmed) {
              setPaymentConfirmed(true);
            }
            const nextTripContext = updateTripContext(serverTrip ?? tripContext, 'booked', {
              bookingRef: ref ?? undefined,
              origin: proof.fromStation ?? undefined,
              destination: proof.toStation ?? undefined,
              departureTime: proof.departureDatetime ?? proof.departureTime ?? undefined,
              arrivalTime: proof.arrivalTime ?? undefined,
              operator: proof.operator ?? undefined,
              finalLegSummary: proof.finalLegSummary ?? undefined,
              watchState: {
                ...(serverTrip ?? tripContext)?.watchState,
                bookingConfirmed: true,
                paymentConfirmed: !!(data.metadata?.paymentConfirmed || data.metadata?.stripePaymentConfirmed || data.metadata?.razorpayPaymentConfirmed),
              },
            });
            setTripContext(nextTripContext);
            setStatusPhase('done');
            setPhase('done');
            void saveActiveTrip({
              intentId: jobId,
              jobId,
              status: 'ticketed',
              title: [proof.fromStation, proof.toStation].filter(Boolean).join(' → ') || 'Train journey',
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
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            const doneMsg = ref
              ? `Securing your ticket. Bro reference ${ref.replace(/-/g, ' ')}. Ticket details by email within 15 minutes.`
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
            ? 'Booking timed out. Please try again.'
            : 'Booking couldn\'t be completed. Please try again.';
          setErrorMsg(errMsg);
          setPhase('error');
          const attentionTrip = updateTripContext(serverTrip ?? tripContext, 'attention');
          setTripContext(attentionTrip);
          void saveActiveTrip({
            intentId: jobId,
            jobId,
            status: 'attention',
            title: [fromStation, toStation].filter(Boolean).join(' → ') || 'Train journey',
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
          await speak(errMsg);
        } else if (elapsed >= POLL_TIMEOUT_S) {
          // Booking confirmation is taking too long — auto-complete may have failed.
          // Show a soft message rather than spinning forever.
          clearInterval(t);
          setStatusPhase('error');
          setErrorMsg('Taking longer than expected. Check your email for confirmation, or try again.');
          setPhase('error');
          const attentionTrip = updateTripContext(serverTrip ?? tripContext, 'attention');
          setTripContext(attentionTrip);
          void saveActiveTrip({
            intentId: jobId,
            jobId,
            status: 'attention',
            title: [fromStation, toStation].filter(Boolean).join(' → ') || 'Train journey',
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
          await speak('This is taking longer than expected. Check your email for a confirmation, or try again.');
        }
      } catch {
        // transient — keep polling
      }
    }, POLL_MS);

    return () => clearInterval(t);
  }, [statusPhase, jobId, elapsed, setPhase, fiatAmount, paramSymbol, paramCode, fromStation, toStation, departureTime, platform, operator, finalLegSummary, tripContext]);

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
        if (data.metadata?.paymentConfirmed || data.metadata?.stripePaymentConfirmed || data.metadata?.razorpayPaymentConfirmed) {
          setPaymentConfirmed(true);
          clearInterval(t);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [statusPhase, paymentConfirmed, jobId]);

  // ── Active journey companion — countdown + voice-overs ────────────────────
  useEffect(() => {
    if (statusPhase !== 'done' || !departureDatetime) return;

    const tick = () => {
      const depMs   = new Date(departureDatetime).getTime();
      const diffMs  = depMs - Date.now();
      const diffMin = Math.floor(diffMs / 60_000);

      // Countdown text
      if (diffMs <= 0) {
        setCountdown(null);
      } else if (diffMin >= 60) {
        const h = Math.floor(diffMin / 60);
        const m = diffMin % 60;
        setCountdown(`Departing in ${h}h ${m}m${platform ? ` · Platform ${platform}` : ''}`);
      } else if (diffMin > 0) {
        setCountdown(`Departing in ${diffMin} min${platform ? ` · Platform ${platform}` : ''}`);
      } else {
        setCountdown(`Departing now${platform ? ` · Platform ${platform}` : ''}`);
      }

      // Voice-overs — each fires once
      const dest = toStation ?? 'your destination';
      const op   = operator  ?? 'Your train';
      if (diffMin <= 30 && diffMin > 25 && !spokenRef.current.t30) {
        spokenRef.current.t30 = true;
        void speak(`30 minutes to departure.${platform ? ` Platform ${platform}.` : ''} ${op} — coach C is usually mid-train.`);
      } else if (diffMin <= 10 && diffMin > 7 && !spokenRef.current.t10) {
        spokenRef.current.t10 = true;
        void speak(`Head to the platform now. 10 minutes to departure.${platform ? ` Platform ${platform}.` : ''}`);
      } else if (diffMs <= 0 && diffMs > -3 * 60_000 && !spokenRef.current.arrived) {
        spokenRef.current.arrived = true;
        void speak(`Welcome to ${dest}. You've arrived.`);
      }
    };

    tick(); // run immediately
    const t = setInterval(tick, 30_000); // update every 30s
    return () => clearInterval(t);
  }, [statusPhase, departureDatetime, platform, operator, toStation]);

  // Keep execution quiet. Voice is reserved for completion, failure,
  // and other material state changes rather than periodic reassurance.

  // ── Render ─────────────────────────────────────────────────────────────────

  const isDone       = statusPhase === 'done';
  const isError      = statusPhase === 'error';
  // Only show full green success once payment is confirmed (or no payment needed)
  const needsPayment = isDone && fiatAmount && parseFloat(fiatAmount) > 0;
  const isFullyDone  = isDone && (!needsPayment || paymentConfirmed);
  const cards = tripCards(tripContext);

  return (
    <SafeAreaView style={styles.safe}>
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
        <Text style={[styles.statusTitle, isFullyDone && styles.statusTitleDone, isError && styles.statusTitleError,
          isDone && needsPayment && !paymentConfirmed && { color: '#fbbf24' }]}>
          {isFullyDone ? 'Journey in hand'
            : isDone && needsPayment && !paymentConfirmed ? 'Request received'
            : isError ? 'Needs attention'
            : 'Working on it'}
        </Text>

        <Text style={styles.statusSub}>
          {isFullyDone
            ? totalLegs > 1
              ? `All ${totalLegs} legs booked. Ticket details arrive by email for each leg.`
              : 'Bro has your journey moving. Ticket details arrive by email shortly.'
            : isDone && needsPayment && !paymentConfirmed
            ? 'Your request is in. Tap below to pay and secure your ticket.'
            : isError
            ? (errorMsg ?? 'Something went wrong.')
            : `${currentAgent?.name ?? 'Bro'} is lining everything up · ${elapsed}s`}
        </Text>
        {isFullyDone && countdown && (
          <View style={styles.countdownBadge}>
            <Ionicons name="time-outline" size={13} color={C.emBright} />
            <Text style={styles.countdownText}>{countdown}</Text>
          </View>
        )}
        {totalLegs > 1 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <Ionicons name="git-branch-outline" size={13} color="#818cf8" />
            <Text style={{ fontSize: 12, color: '#818cf8' }}>{totalLegs}-leg journey · Leg 1 of {totalLegs}</Text>
          </View>
        )}

        {/* Booking reference pill */}
        {isDone && bookingRef && (
          <View style={styles.bookingRefWrap}>
            <Text style={styles.bookingRefLabel}>Bro Reference</Text>
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
              <ProactiveStatusCard key={card.id} card={card} />
            ))}
          </View>
        )}

        {isDone && !paymentConfirmed && fiatAmount && parseFloat(fiatAmount) > 0 && (
          <Pressable
            onPress={async () => {
              if (payLoading) return;
              setPayLoading(true);
              try {
                if ((paramCode ?? 'GBP').toUpperCase() === 'INR') {
                  const { shortUrl } = await createUpiPaymentLink({
                    jobId,
                    journeyId: paramJourneyId,
                    amountInr: Math.round(parseFloat(fiatAmount)),
                    description: [fromStation, toStation].filter(Boolean).join(' -> ') || 'Bro booking',
                  });
                  await Linking.openURL(shortUrl);
                } else {
                  const { url } = await createCheckoutSession({
                    jobId,
                    journeyId: paramJourneyId,
                    amountFiat:   parseFloat(fiatAmount),
                    currencyCode: paramCode ?? 'GBP',
                    description:  [fromStation, toStation].filter(Boolean).join(' → ') || 'Bro booking',
                  });
                  await Linking.openURL(url);
                }
              } catch (e: any) {
                setErrorMsg(e?.message ?? 'Could not open payment — please try again.');
              } finally {
                setPayLoading(false);
              }
            }}
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

        {/* Payment confirmed badge */}
        {isDone && paymentConfirmed && (
          <View style={styles.paidBadge}>
            <Ionicons name="checkmark-circle" size={16} color="#4ade80" />
            <Text style={styles.paidBadgeText}>Payment confirmed</Text>
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
              router.push(`/receipt/${jobId}?${qs.toString()}`);
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
                    title: 'Join my trip on Bro',
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

function ProactiveStatusCard({ card }: { card: ProactiveCard }) {
  const accent = card.severity === 'warning' ? '#f59e0b' : card.severity === 'success' ? '#4ade80' : '#60a5fa';
  return (
    <View style={[styles.proactiveCard, { borderColor: `${accent}33` }]}>
      <View style={[styles.proactiveDot, { backgroundColor: accent }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.proactiveTitle}>{card.title}</Text>
        <Text style={styles.proactiveBody}>{card.body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: C.bg },
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

  statusTitle:            { fontSize: 32, fontWeight: '800', color: C.textPrimary, marginBottom: 10, letterSpacing: -0.5 },
  statusTitleDone:        { color: C.green },
  statusTitleRequested:   { color: C.amber },
  statusTitleError:       { color: C.red },

  statusSub: {
    fontSize: 15,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 23,
    marginBottom: 40,
    paddingHorizontal: 16,
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
  shareTripBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#1e293b', marginBottom: 10 },
  shareTripText: { fontSize: 15, color: C.sky, fontWeight: '500' },

  countdownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.emDim,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.emGlow,
  },
  countdownText: { fontSize: 13, fontWeight: '600', color: C.emBright, letterSpacing: 0.2 },
});
