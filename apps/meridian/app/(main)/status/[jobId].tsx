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

const POLL_MS = 3000;

type StatusPhase = 'executing' | 'done' | 'error';

export default function StatusScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { openaiKey, currentAgent, setPhase } = useStore();

  const [statusPhase, setStatusPhase] = useState<StatusPhase>('executing');
  const [elapsed, setElapsed]         = useState(0);
  const [errorMsg, setErrorMsg]       = useState<string | null>(null);

  const checkRef    = useRef(false);     // prevent double-narration
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
            setStatusPhase('done');
            setPhase('done');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await speak('Done! Your receipt is ready.', openaiKey);
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
          setErrorMsg(`Job ${s}.`);
          setPhase('error');
          await speak(`The job ${s}. Please try again.`, openaiKey);
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
    speak(statusNarration(currentAgent, elapsed), openaiKey);
  }, [elapsed, statusPhase, currentAgent]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const isDone  = statusPhase === 'done';
  const isError = statusPhase === 'error';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>

        {/* Back */}
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color="#4b5563" />
        </Pressable>

        {/* Agent name */}
        {currentAgent && (
          <Text style={styles.agentLabel}>
            {currentAgent.name}
          </Text>
        )}

        {/* Main orb visual */}
        <View style={styles.orbWrap}>
          <Animated.View style={{ transform: [{ scale: orbScale }] }}>
            {isDone ? (
              <LinearGradient colors={['#052e16', '#14532d']} style={styles.orb}>
                <Ionicons name="checkmark" size={52} color="#4ade80" />
              </LinearGradient>
            ) : isError ? (
              <LinearGradient colors={['#450a0a', '#7f1d1d']} style={styles.orb}>
                <Ionicons name="warning-outline" size={44} color="#f87171" />
              </LinearGradient>
            ) : (
              <OrbWorking />
            )}
          </Animated.View>
        </View>

        {/* Status text */}
        <Text style={[styles.statusTitle, isDone && styles.statusTitleDone, isError && styles.statusTitleError]}>
          {isDone ? 'Complete' : isError ? 'Failed' : 'Working…'}
        </Text>

        <Text style={styles.statusSub}>
          {isDone
            ? 'Your task has been completed successfully.'
            : isError
            ? (errorMsg ?? 'Something went wrong.')
            : `${currentAgent?.name ?? 'Agent'} is on it · ${elapsed}s`}
        </Text>

        {/* CTA */}
        {isDone && (
          <Animated.View style={[styles.ctaWrap, { opacity: fadeSuccess }]}>
            <Pressable
              onPress={() => router.push(`/receipt/${jobId}`)}
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
      <LinearGradient colors={['#1e1b4b', '#312e81']} style={styles.orb}>
        <Ionicons name="pulse" size={44} color="#818cf8" />
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
    borderWidth: 1,
    borderColor: '#6366f1',
  },
});

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#080808' },
  container: { flex: 1, paddingHorizontal: 28, alignItems: 'center' },

  back: { alignSelf: 'flex-start', marginTop: 8, marginBottom: 24 },

  agentLabel: {
    fontSize: 13,
    color: '#4b5563',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 40,
  },

  orbWrap: { marginBottom: 32 },
  orb: {
    width:  120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 12,
  },

  statusTitle:       { fontSize: 28, fontWeight: '700', color: '#f9fafb', marginBottom: 10 },
  statusTitleDone:   { color: '#4ade80' },
  statusTitleError:  { color: '#f87171' },

  statusSub: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 40,
    paddingHorizontal: 20,
  },

  ctaWrap: { width: '100%', alignItems: 'center' },
  receiptBtn: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
  },
  receiptBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  receiptBtnText: { fontSize: 17, fontWeight: '700', color: '#4ade80' },

  newRequestBtn: { paddingVertical: 12 },
  newRequestText: { fontSize: 14, color: '#4b5563' },

  retryBtn: { paddingVertical: 16 },
  retryText: { fontSize: 15, color: '#6b7280' },
});
