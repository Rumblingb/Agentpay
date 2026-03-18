/**
 * Converse — the Meridian concierge screen
 *
 * UX philosophy: the human talks, Meridian acts.
 * No agent cards. No hire button. No plumbing visible.
 *
 * Phases:
 *   idle       → orb glows, "Hold to talk"
 *   listening  → orb pulses with rings, "Listening…"
 *   thinking   → orb spins, Meridian narrates via TTS
 *   confirming → orb amber, single voice yes/no (for amounts above auto-limit)
 *   hiring     → orb spins, "Hiring [agent]…"
 *   executing  → orb spins, routes to /status/:jobId
 *   error      → orb red, error message, tap to retry
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { processIntent, executeHire, type ConciergeNeedsConfirm } from '../../lib/concierge';

// ── Narration for each phase label ────────────────────────────────────────────

const PHASE_LABEL: Record<string, string> = {
  idle:       'Hold to talk',
  listening:  'Listening…',
  thinking:   'Finding the best agent…',
  confirming: 'Say yes to confirm, or no to cancel',
  hiring:     'Hiring…',
  executing:  'Agent working…',
  done:       'Done',
  error:      'Tap to try again',
};

export default function ConverseScreen() {
  const {
    phase, setPhase,
    transcript, setTranscript,
    pendingConfirm, setPendingConfirm,
    currentAgent, setCurrentAgent,
    currentJob, setCurrentJob,
    turns, addTurn,
    error, setError,
    agentId, openaiKey,
    userName, autoConfirmLimitUsdc,
    reset,
  } = useStore();

  const scrollRef = useRef<ScrollView>(null);

  // Auto-scroll conversation when new turns arrive
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [turns]);

  // ── Hold-to-talk handlers ──────────────────────────────────────────────────

  const handlePressIn = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'error' && phase !== 'confirming') return;

    if (phase === 'confirming') {
      // Treat hold-to-talk as the voice reply during confirm phase
      await startRecording().catch(() => {});
      setPhase('listening');
      return;
    }

    await stopSpeaking();
    reset();
    setPhase('listening');
    await startRecording().catch((e: Error) => {
      setError('Microphone access denied. Enable it in Settings.');
    });
  }, [phase]);

  const handlePressOut = useCallback(async () => {
    if (phase !== 'listening') return;
    setPhase('thinking');

    try {
      const uri = await stopRecording();
      if (!uri) throw new Error('No audio recorded.');

      if (!openaiKey) throw new Error('OpenAI key not set. Go to Settings.');

      const text = await transcribeAudio(uri, openaiKey);
      if (!text) throw new Error('Could not understand that. Please try again.');

      setTranscript(text);
      const userTurn = { role: 'user' as const, text, ts: Date.now() };
      addTurn(userTurn);
      await appendHistory(userTurn);

      // ── If we're in confirming phase — handle yes/no ─────────────────────
      if (pendingConfirm) {
        const lower = text.toLowerCase();
        const isYes = /\b(yes|yeah|sure|ok|okay|go|do it|confirm|proceed)\b/.test(lower);
        const isNo  = /\b(no|nope|cancel|stop|abort|don't|forget it)\b/.test(lower);

        if (isYes) {
          setPhase('hiring');
          await say(`Hiring ${pendingConfirm.agent.name} now.`);
          const result = await executeHire({
            hirerId: agentId!,
            agent: pendingConfirm.agent,
            jobDescription: transcript,
            coordinationId: pendingConfirm.coordinationId,
          });
          const agentTurn = {
            role: 'meridian' as const,
            text: `Hired ${pendingConfirm.agent.name}. Tracking your job.`,
            ts: Date.now(),
          };
          addTurn(agentTurn);
          await appendHistory(agentTurn);
          setCurrentAgent(pendingConfirm.agent);
          setCurrentJob({ ...({} as any), jobId: result.jobId, agreedPriceUsdc: result.agreedPriceUsdc, agentId: result.agent.agentId } as any);
          setPendingConfirm(null);
          setPhase('executing');
          router.push(`/status/${result.jobId}`);
          return;
        }

        if (isNo) {
          setPendingConfirm(null);
          await say('Okay, cancelled.');
          const turn = { role: 'meridian' as const, text: 'Cancelled.', ts: Date.now() };
          addTurn(turn);
          await appendHistory(turn);
          setPhase('idle');
          return;
        }

        // Unclear — ask again
        await say("Sorry, I didn't catch that. Say yes to confirm, or no to cancel.");
        setPhase('confirming');
        return;
      }

      // ── Normal intent flow ───────────────────────────────────────────────
      if (!agentId) throw new Error('No agent identity. Please restart the app.');

      const outcome = await processIntent({
        intent:               text,
        hirerId:              agentId,
        autoConfirmLimitUsdc,
        openaiKey,
      });

      if ('needsConfirm' in outcome) {
        // Voice confirm required
        const confirm = outcome as ConciergeNeedsConfirm;
        setPendingConfirm(confirm);
        const meridianTurn = {
          role: 'meridian' as const,
          text: `${confirm.agent.name} — $${confirm.estimatedPriceUsdc.toFixed(2)} USDC. Say yes to confirm.`,
          ts: Date.now(),
        };
        addTurn(meridianTurn);
        await appendHistory(meridianTurn);
        setPhase('confirming');
      } else {
        // Auto-hired
        setPhase('hiring');
        const meridianTurn = {
          role: 'meridian' as const,
          text: `Hired ${outcome.agent.name}. Tracking your job now.`,
          ts: Date.now(),
        };
        addTurn(meridianTurn);
        await appendHistory(meridianTurn);
        setCurrentAgent(outcome.agent);
        setCurrentJob({ jobId: outcome.jobId, agreedPriceUsdc: outcome.agreedPriceUsdc, agentId: outcome.agent.agentId } as any);
        setPhase('executing');
        router.push(`/status/${outcome.jobId}`);
      }
    } catch (e: any) {
      const msg = e.message ?? 'Something went wrong.';
      setError(msg);
      await say(`Sorry — ${msg}`);
    }
  }, [phase, pendingConfirm, agentId, openaiKey, transcript, autoConfirmLimitUsdc]);

  // ── TTS shorthand ──────────────────────────────────────────────────────────
  const say = (text: string) => speak(text, openaiKey);

  // ── Render ─────────────────────────────────────────────────────────────────

  const phaseLabel = PHASE_LABEL[phase] ?? '';
  const isIdle = phase === 'idle';
  const isError = phase === 'error';

  return (
    <SafeAreaView style={styles.safe}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Meridian</Text>
        <Pressable
          onPress={() => router.push('/settings')}
          hitSlop={12}
        >
          <Ionicons name="settings-outline" size={20} color="#4b5563" />
        </Pressable>
      </View>

      {/* Conversation history */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {turns.length === 0 && isIdle && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyGreeting}>
              {`Hello${useStore.getState().userName !== 'there' ? `, ${useStore.getState().userName}` : ''}.`}
            </Text>
            <Text style={styles.emptyHint}>
              {'What can I help you with today?'}
            </Text>
            <View style={styles.suggestions}>
              <Suggestion text="Book a flight to New York" />
              <Suggestion text="Find me a hotel in London" />
              <Suggestion text="Arrange airport transport" />
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

        {/* Pending confirm indicator */}
        {phase === 'confirming' && pendingConfirm && (
          <View style={styles.confirmCard}>
            <Ionicons name="alert-circle-outline" size={16} color="#fcd34d" />
            <Text style={styles.confirmText}>
              {`${pendingConfirm.agent.name} · $${pendingConfirm.estimatedPriceUsdc.toFixed(2)} USDC`}
            </Text>
          </View>
        )}

        {isError && error && (
          <View style={styles.errorCard}>
            <Ionicons name="warning-outline" size={16} color="#f87171" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={{ height: 260 }} />
      </ScrollView>

      {/* Orb + label — fixed bottom */}
      <View style={styles.orbArea}>
        <Text style={styles.phaseLabel}>{phaseLabel}</Text>

        <OrbAnimation
          phase={phase}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={phase === 'hiring' || phase === 'executing' || phase === 'done'}
        />

        {(isIdle || isError) && turns.length > 0 && (
          <Pressable
            onPress={() => { reset(); }}
            style={styles.clearBtn}
            hitSlop={12}
          >
            <Text style={styles.clearBtnText}>Clear</Text>
          </Pressable>
        )}
      </View>

    </SafeAreaView>
  );
}

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

const styles = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: '#080808' },

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

  emptyState:   { paddingTop: 32, paddingBottom: 20 },
  emptyGreeting:{ fontSize: 26, fontWeight: '700', color: '#f9fafb', marginBottom: 8 },
  emptyHint:    { fontSize: 16, color: '#6b7280', marginBottom: 24, lineHeight: 24 },
  suggestions:  { gap: 0 },

  bubble: {
    maxWidth: '85%',
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  bubbleUser: { alignSelf: 'flex-end' },
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
    gap: 8,
    backgroundColor: '#1c1400',
    borderWidth: 1,
    borderColor: '#78350f',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  confirmText: { fontSize: 14, color: '#fcd34d' },

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
