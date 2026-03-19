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
import { loadProfileRaw, hasProfile, loadProfileAuthenticated } from '../../lib/profile';
import { authenticateWithBiometrics } from '../../lib/biometric';

// ── Phase labels ──────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<string, string> = {
  idle:       'Hold to talk',
  listening:  'Listening…',
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
    reset,
  } = useStore();

  // Pending plan — awaiting biometric confirmation
  const pendingPlanRef = useRef<{
    transcript: string;
    plan: ConciergePlanItem[];
    travelProfile?: Record<string, unknown>;
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

    // Load travel profile — biometric-gated, silent on failure
    let travelProfile: Record<string, unknown> | undefined;
    try {
      if (await hasProfile()) {
        // Profile read is biometric-gated inside loadProfileAuthenticated.
        // We load it here so it's ready to send scoped fields to the server.
        const profile = await loadProfileAuthenticated();
        if (profile) travelProfile = profile as unknown as Record<string, unknown>;
      }
    } catch {
      // Auth cancelled or no profile — proceed without
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

    // If plan needs biometric confirmation, store it and gate
    if (response.needsBiometric && response.plan && response.plan.length > 0) {
      pendingPlanRef.current = { transcript: text, plan: response.plan, travelProfile };
      setPhase('confirming');
      return;
    }

    // No action needed (research, clarification, or error from Claude)
    setPhase('idle');
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

    setPhase('thinking');
    const { transcript: savedTranscript, plan, travelProfile } = pending;
    pendingPlanRef.current = null;

    const response = await executeIntent({
      transcript:   savedTranscript,
      hirerId:      agentId!,
      travelProfile,
      plan,
    });

    const meridianTurn = {
      role: 'meridian' as const,
      text: response.narration,
      ts:   Date.now(),
    };
    addTurn(meridianTurn);
    await appendHistory(meridianTurn);
    await speak(response.narration);

    if (response.actions.length > 0) {
      setPhase('done');
      router.push(`/status/${response.actions[0].jobId}`);
    } else {
      setPhase('idle');
    }
  }, [agentId]);

  // ── Hold-to-talk ──────────────────────────────────────────────────────────

  const handlePressIn = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'error') return;
    await stopSpeaking();
    if (phase === 'error') reset();
    setPhase('listening');
    await startRecording().catch(() => {
      setError('Microphone access denied. Enable it in Settings.');
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [phase]);

  const handlePressOut = useCallback(async () => {
    if (phase !== 'listening') return;
    setPhase('thinking');

    try {
      const uri = await stopRecording();
      if (!uri) throw new Error('No audio recorded.');

      const text = await transcribeAudio(uri);
      if (!text) throw new Error('Could not understand that. Please try again.');

      await handleIntent(text);
    } catch (e: any) {
      const msg = e.message ?? 'Something went wrong.';
      setError(msg);
      await speak(`Sorry — ${msg}`);
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
        <Pressable onPress={() => router.push('/settings')} hitSlop={12}>
          <Ionicons name="settings-outline" size={20} color="#4b5563" />
        </Pressable>
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

        {isConfirming && (
          <Pressable style={styles.confirmCard} onPress={handleBiometricConfirm}>
            <Ionicons name="finger-print-outline" size={18} color="#818cf8" />
            <Text style={styles.confirmText}>Tap to confirm with fingerprint</Text>
          </Pressable>
        )}

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
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0d0b1f',
    borderWidth: 1,
    borderColor: '#4338ca',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  confirmText: { fontSize: 15, color: '#a5b4fc', fontWeight: '500' },

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
