/**
 * Converse — the Bro concierge screen
 *
 * Flow:
 *   Hold to talk → Whisper STT → Phase 1 (plan, no hire)
 *   → Bro speaks price → fingerprint gate
 *   → Phase 2 (execute hire) → receipt
 *
 * Two biometric moments:
 *   1. Profile release — before sending profile to server (silent, in background)
 *   2. Payment confirm — after price announced, before hire fires
 *
 * Phases: idle → listening → thinking → confirming → done | error
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  SafeAreaView,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { OrbAnimation } from '../../components/OrbAnimation';
import { useStore } from '../../lib/store';
import { startRecording, stopRecording, transcribeAudio } from '../../lib/speech';
import { speak, stopSpeaking } from '../../lib/tts';
import { appendHistory } from '../../lib/storage';
import { planIntent, executeIntent, type ConciergePlanItem } from '../../lib/concierge';
import { loadProfileRaw, hasProfile } from '../../lib/profile';
import { authenticateWithBiometrics } from '../../lib/biometric';

// ── Phase labels ──────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<string, string> = {
  idle:       'Tap to talk',
  listening:  'Listening… tap to send',
  thinking:   'On it…',
  confirming: 'Fingerprint to confirm',
  done:       'Done',
  error:      'Tap to try again',
};

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ConverseScreen() {
  const {
    phase, setPhase,
    transcript, setTranscript,
    turns, addTurn,
    error, setError,
    agentId,
    userName,
    autoConfirmLimitUsdc,
    setCurrentAgent,
    reset,
  } = useStore();

  // Pending plan — awaiting biometric confirmation
  const pendingPlanRef = useRef<{
    transcript: string;
    plan: ConciergePlanItem[];
    /** Scoped (non-sensitive) profile used in Phase 1 narration */
    travelProfile?: Record<string, unknown>;
    /** Full profile — only loaded for Phase 2 after biometric confirmation */
    fullProfile?: Record<string, unknown>;
    /** Total estimated cost across all plan items */
    totalPriceUsdc: number;
  } | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [turns]);

  // ── Phase 1: plan ─────────────────────────────────────────────────────────

  const handleIntent = useCallback(async (text: string) => {
    if (!agentId) throw new Error('No agent identity. Please restart the app.');

    setTranscript(text);
    const userTurn = { role: 'user' as const, text, ts: Date.now() };
    addTurn(userTurn);
    await appendHistory(userTurn);

    setPhase('thinking');

    // Load travel profile without biometric.
    // Phase 1 sends only non-sensitive preference fields so Claude can personalise
    // the narration ("with your 16-25 railcard, standard class").
    // Document numbers, passport, email, phone stay on device until Phase 2.
    let travelProfile:  Record<string, unknown> | undefined;
    let fullProfile:    Record<string, unknown> | undefined;
    try {
      if (await hasProfile()) {
        const profile = await loadProfileRaw();
        if (profile) {
          fullProfile = profile as unknown as Record<string, unknown>;
          // Phase 1: safe fields only — no identity documents or contact details
          travelProfile = {
            legalName:       profile.legalName,
            nationality:     profile.nationality,
            seatPreference:  profile.seatPreference,
            classPreference: profile.classPreference,
            railcardNumber:  profile.railcardNumber,
          };
        }
      }
    } catch {
      // No profile stored — proceed without
    }

    // Phase 1: get a plan from Claude — no hire fires yet
    const response = await planIntent({
      transcript:   text,
      hirerId:      agentId,
      travelProfile,
    });

    const meridianTurn = {
      role: 'meridian' as const,
      text: response.narration,
      ts:   Date.now(),
    };
    addTurn(meridianTurn);
    await appendHistory(meridianTurn);
    await speak(response.narration);

    // If plan needs biometric confirmation, store it
    if (response.needsBiometric && response.plan && response.plan.length > 0) {
      const total = response.estimatedPriceUsdc ?? 0;
      pendingPlanRef.current = { transcript: text, plan: response.plan, travelProfile, fullProfile, totalPriceUsdc: total };

      // Auto-confirm if total is within the spending limit (no fingerprint needed)
      if (total > 0 && total <= autoConfirmLimitUsdc) {
        await executePhase2(pendingPlanRef.current);
        return;
      }

      // Above limit — show confirmation card with price + fingerprint gate
      setPhase('confirming');
      return;
    }

    // No action needed (research, clarification, or error from Claude)
    setPhase('idle');
  }, [agentId, autoConfirmLimitUsdc]);

  // ── Shared Phase 2 executor ───────────────────────────────────────────────

  const executePhase2 = useCallback(async (pending: NonNullable<typeof pendingPlanRef.current>) => {
    setPhase('thinking');
    const { transcript: savedTranscript, plan, fullProfile } = pending;
    pendingPlanRef.current = null;

    try {
      const response = await executeIntent({
        transcript:    savedTranscript,
        hirerId:       agentId!,
        travelProfile: fullProfile,
        plan,
      });

      const meridianTurn = { role: 'meridian' as const, text: response.narration, ts: Date.now() };
      addTurn(meridianTurn);
      await appendHistory(meridianTurn);
      await speak(response.narration);

      if (response.actions.length > 0) {
        const firstAction = response.actions[0];
        setCurrentAgent({
          agentId:         firstAction.agentId,
          name:            firstAction.agentName,
          category:        firstAction.toolName,
          description:     firstAction.displayName,
          capabilities:    [],
          pricePerTaskUsd: firstAction.agreedPriceUsdc,
          trustScore:      0,
          grade:           'B',
          verified:        true,
          passportUrl:     `https://app.agentpay.so/agent/${firstAction.agentId}`,
        });
        setPhase('done');
        router.push(`/status/${firstAction.jobId}`);
      } else {
        setPhase('idle');
      }
    } catch (e: any) {
      const msg = e.message ?? 'Booking failed. Please try again.';
      setError(msg);
      await speak(`Sorry — ${msg}`);
    }
  }, [agentId]);

  // ── Phase 2: biometric → execute ─────────────────────────────────────────

  const handleBiometricConfirm = useCallback(async () => {
    const pending = pendingPlanRef.current;
    if (!pending) return;

    const authed = await authenticateWithBiometrics('Confirm booking and payment');
    if (!authed) {
      await speak('Payment cancelled.');
      addTurn({ role: 'meridian', text: 'Payment cancelled.', ts: Date.now() });
      pendingPlanRef.current = null;
      setPhase('idle');
      return;
    }

    await executePhase2(pending);
  }, [agentId, executePhase2]);

  // ── Cancel confirmation ───────────────────────────────────────────────────

  const handleCancelConfirm = useCallback(async () => {
    pendingPlanRef.current = null;
    await speak('OK, cancelled.');
    addTurn({ role: 'meridian', text: 'OK, cancelled.', ts: Date.now() });
    setPhase('idle');
  }, []);

  // ── Tap-to-talk (tap once = start, tap again = stop + send) ──────────────

  const handleTap = useCallback(async () => {
    // Tap while idle/error → start listening
    if (phase === 'idle' || phase === 'error') {
      await stopSpeaking();
      if (phase === 'error') reset();
      setPhase('listening');
      try {
        await startRecording();
      } catch {
        setError('Microphone access denied. Go to Settings → Apps → Bro → Permissions → Microphone.');
        setPhase('error');
      }
      return;
    }

    // Tap while listening → stop and process
    if (phase === 'listening') {
      setPhase('thinking');
      try {
        const uri = await stopRecording();
        if (!uri) { setPhase('idle'); return; }

        let text = '';
        try {
          text = await transcribeAudio(uri);
        } catch {
          setError('Could not reach voice service — check your connection and try again.');
          setPhase('error');
          return;
        }

        if (!text.trim()) {
          setError("Didn't catch that — please try again.");
          setPhase('error');
          return;
        }

        await handleIntent(text);
      } catch (e: any) {
        setError(e.message ?? 'Something went wrong.');
        setPhase('error');
      }
    }
  }, [phase, handleIntent]);

  // ── Render ────────────────────────────────────────────────────────────────

  const phaseLabel = PHASE_LABEL[phase] ?? '';
  const isIdle     = phase === 'idle';
  const isError    = phase === 'error';
  const isBusy     = phase === 'thinking' || phase === 'done';
  const isConfirming = phase === 'confirming';

  return (
    <SafeAreaView style={styles.safe}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Bro</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Pressable onPress={() => router.push('/(main)/trips')} hitSlop={12}>
            <Ionicons name="time-outline" size={20} color="#4b5563" />
          </Pressable>
          <Pressable onPress={() => router.push('/settings')} hitSlop={12}>
            <Ionicons name="settings-outline" size={20} color="#4b5563" />
          </Pressable>
        </View>
      </View>

      {/* Conversation */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {turns.length === 0 && isIdle && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyGreeting}>
              {`Hello${userName !== 'there' ? `, ${userName}` : ''}.`}
            </Text>
            <Text style={styles.emptyHint}>What can I help you with today?</Text>
            <View style={styles.suggestions}>
              <Suggestion text="Book a train to London" />
              <Suggestion text="Find me a hotel in Manchester" />
              <Suggestion text="Get me a taxi from the station" />
            </View>
          </View>
        )}

        {turns.map((turn, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              turn.role === 'user' ? styles.bubbleUser : styles.bubbleMeridian,
            ]}
          >
            {turn.role === 'meridian' && (
              <View style={styles.bubbleAvatar}>
                <Ionicons name="sparkles" size={12} color="#818cf8" />
              </View>
            )}
            <Text style={[
              styles.bubbleText,
              turn.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextMeridian,
            ]}>
              {turn.text}
            </Text>
          </View>
        ))}

        {isConfirming && (() => {
          const total = pendingPlanRef.current?.totalPriceUsdc ?? 0;
          const priceLabel = total > 0 ? `£${total.toFixed(2)}` : null;
          return (
            <View style={styles.confirmCard}>
              {priceLabel && (
                <Text style={styles.confirmPrice}>{priceLabel}</Text>
              )}
              <Pressable style={styles.confirmBtn} onPress={handleBiometricConfirm}>
                <Ionicons name="finger-print-outline" size={18} color="#818cf8" />
                <Text style={styles.confirmText}>Confirm with fingerprint</Text>
              </Pressable>
              <Pressable style={styles.confirmCancel} onPress={handleCancelConfirm}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
            </View>
          );
        })()}

        {isError && error && (
          <View style={styles.errorCard}>
            <Ionicons name="warning-outline" size={16} color="#f87171" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={{ height: 260 }} />
      </ScrollView>

      {/* Orb + label */}
      <View style={styles.orbArea}>
        <Text style={styles.phaseLabel}>{phaseLabel}</Text>

        <OrbAnimation
          phase={phase}
          onPress={handleTap}
          disabled={isBusy || isConfirming}
        />

        {(isIdle || isError) && turns.length > 0 && (
          <Pressable onPress={() => reset()} style={styles.clearBtn} hitSlop={12}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </Pressable>
        )}
      </View>

    </SafeAreaView>
  );
}

// ── Suggestion chip ───────────────────────────────────────────────────────────

function Suggestion({ text }: { text: string }) {
  return (
    <View style={suggStyles.chip}>
      <Text style={suggStyles.text}>{text}</Text>
    </View>
  );
}

const suggStyles = StyleSheet.create({
  chip: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 13, color: '#6b7280' },
});

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080808' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#111',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f9fafb',
    letterSpacing: -0.3,
  },

  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16 },

  emptyState:    { paddingTop: 32, paddingBottom: 20 },
  emptyGreeting: { fontSize: 26, fontWeight: '700', color: '#f9fafb', marginBottom: 8 },
  emptyHint:     { fontSize: 16, color: '#6b7280', marginBottom: 24, lineHeight: 24 },
  suggestions:   {},

  bubble: {
    maxWidth: '85%',
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  bubbleUser:     { alignSelf: 'flex-end' },
  bubbleMeridian: { alignSelf: 'flex-start' },
  bubbleAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1e1b4b',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  bubbleTextUser: {
    backgroundColor: '#1e1b4b',
    color: '#e0e7ff',
    borderBottomRightRadius: 4,
  },
  bubbleTextMeridian: {
    backgroundColor: '#111',
    color: '#d1d5db',
    borderBottomLeftRadius: 4,
  },

  confirmCard: {
    backgroundColor: '#0d0b1f',
    borderWidth: 1,
    borderColor: '#4338ca',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    alignSelf: 'stretch',
    gap: 10,
  },
  confirmPrice: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f9fafb',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1e1b4b',
    borderRadius: 10,
    paddingVertical: 12,
  },
  confirmText: { fontSize: 15, color: '#a5b4fc', fontWeight: '500' },
  confirmCancel: { alignItems: 'center', paddingVertical: 8 },
  confirmCancelText: { fontSize: 13, color: '#374151' },

  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#0f0505',
    borderWidth: 1,
    borderColor: '#7f1d1d',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: 13, color: '#fca5a5', lineHeight: 19 },

  orbArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: 48,
    paddingTop: 16,
    backgroundColor: 'rgba(8,8,8,0.95)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#111',
  },
  phaseLabel: {
    fontSize: 13,
    color: '#4b5563',
    marginBottom: 16,
    letterSpacing: 0.2,
  },
  clearBtn: { marginTop: 16 },
  clearBtnText: { fontSize: 13, color: '#374151' },
});
