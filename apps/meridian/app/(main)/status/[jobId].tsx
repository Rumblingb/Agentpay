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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { getIntentStatus } from '../../../lib/api';
import { useStore } from '../../../lib/store';
import { speak } from '../../../lib/tts';
import { statusNarration } from '../../../lib/concierge';
import { C } from '../../../lib/theme';

const POLL_MS = 3000;

type StatusPhase = 'executing' | 'done' | 'error';

export default function StatusScreen() {
  const { jobId, fiatAmount, currencySymbol: paramSymbol, currencyCode: paramCode } =
    useLocalSearchParams<{ jobId: string; fiatAmount?: string; currencySymbol?: string; currencyCode?: string }>();
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
  const [finalLegSummary, setFinalLegSummary] = useState<string | null>(null);

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
    if (statusPhase !== 'executing' || !jobId) return;

    const t = setInterval(async () => {
      try {
        const data = await getIntentStatus(jobId);
        const s = data.status;

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
            if (proof.finalLegSummary) setFinalLegSummary(proof.finalLegSummary);
            setStatusPhase('done');
            setPhase('done');
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
          await speak(errMsg);
        } else if (elapsed >= POLL_TIMEOUT_S) {
          // Booking confirmation is taking too long — auto-complete may have failed.
          // Show a soft message rather than spinning forever.
          clearInterval(t);
          setStatusPhase('error');
          setErrorMsg('Taking longer than expected. Check your email for confirmation, or try again.');
          setPhase('error');
          await speak('This is taking longer than expected. Check your email for a confirmation, or try again.');
        }
      } catch {
        // transient — keep polling
      }
    }, POLL_MS);

    return () => clearInterval(t);
  }, [statusPhase, jobId]);

  // ── Periodic narration during execution ───────────────────────────────────
  useEffect(() => {
    if (statusPhase !== 'executing' || !currentAgent) return;
    if (elapsed === 0 || elapsed % 20 !== 0) return;
    speak(statusNarration(currentAgent, elapsed));
  }, [elapsed, statusPhase, currentAgent]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const isDone  = statusPhase === 'done';
  const isError = statusPhase === 'error';

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
            {isDone ? (
              <LinearGradient colors={[C.emDim, C.greenMid]} style={[styles.orb, { shadowColor: C.green }]}>
                  <Ionicons name="checkmark" size={52} color={C.green} />
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
        <Text style={[styles.statusTitle, isDone && styles.statusTitleDone, isError && styles.statusTitleError]}>
          {isDone ? 'Securing ticket' : isError ? 'Failed' : 'On it…'}
        </Text>

        <Text style={styles.statusSub}>
          {isDone
            ? 'Your request is in. Ticket details arrive by email within 15 minutes.'
            : isError
            ? (errorMsg ?? 'Something went wrong.')
            : `${currentAgent?.name ?? 'Bro'} is working · ${elapsed}s`}
        </Text>

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

        {/* CTA */}
        {isDone && (
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
                if (fiatAmount)  qs.set('fiatAmount',    fiatAmount);
              if (paramSymbol) qs.set('currencySymbol', paramSymbol);
              if (paramCode)   qs.set('currencyCode',   paramCode);
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
});
