/**
 * Converse — the main voice interaction screen
 *
 * Phases:
 *   idle       → show VoiceButton, prompt "Hold to talk"
 *   listening  → recording, VoiceButton pulsing
 *   thinking   → STT done, calling IntentCoordinator
 *   confirming → show IntentCard + AgentCards + PaymentConfirm
 *   hiring     → POST /marketplace/hire in flight
 *   executing  → polling job status
 *   done       → show receipt CTA
 *   error      → show error + retry
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { VoiceButton } from '../../components/VoiceButton';
import { IntentCard } from '../../components/IntentCard';
import { AgentCard } from '../../components/AgentCard';
import { PaymentConfirm } from '../../components/PaymentConfirm';

import { useStore } from '../../lib/store';
import {
  startRecording,
  stopRecording,
  transcribeAudio,
  speak,
} from '../../lib/speech';
import {
  coordinateIntent,
  hireAgent,
} from '../../lib/api';
import type { Agent } from '../../lib/api';

const DEFAULT_BUDGET = 10; // USDC

export default function ConverseScreen() {
  const {
    phase, setPhase,
    transcript, setTranscript,
    plan, setPlan,
    selectedAgent, selectAgent,
    wallet, setError,
    agentId, agentKey, openaiKey,
    addTurn, reset, setCurrentJob,
  } = useStore();

  const [showConfirm, setShowConfirm] = useState(false);
  const [hiring, setHiring] = useState(false);

  // ── Voice handlers ──────────────────────────────────────────────────────

  const handlePressIn = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'error') return;
    reset();
    setPhase('listening');
    try {
      await startRecording();
    } catch (e: any) {
      setError('Microphone access denied. Please enable mic permissions.');
    }
  }, [phase]);

  const handlePressOut = useCallback(async () => {
    if (phase !== 'listening') return;
    setPhase('thinking');

    try {
      const uri = await stopRecording();
      if (!uri) throw new Error('No audio recorded');

      const key = openaiKey ?? process.env.EXPO_PUBLIC_OPENAI_KEY ?? '';
      if (!key) throw new Error('OpenAI API key not set. Add EXPO_PUBLIC_OPENAI_KEY to .env');

      const text = await transcribeAudio(uri, key);
      setTranscript(text);
      addTurn('user', text);

      // Call IntentCoordinatorAgent
      const result = await coordinateIntent({
        intent: text,
        budget: DEFAULT_BUDGET,
        callerAgentId: agentId ?? undefined,
      });

      setPlan(result.coordinationId, result.plan);

      // Auto-select best agent
      if (result.plan.candidateAgents.length > 0) {
        selectAgent(result.plan.candidateAgents[0]);
      }

      const agentName = result.plan.candidateAgents[0]?.name ?? 'an agent';
      speak(`I found ${result.plan.candidateAgents.length} agents. ${agentName} looks like the best match. Want me to hire them?`);

      setPhase('confirming');
    } catch (e: any) {
      console.error('[converse]', e.message);
      setError(e.message ?? 'Something went wrong');
      speak('Sorry, something went wrong. Please try again.');
    }
  }, [phase, agentId, openaiKey]);

  // ── Hire handler ────────────────────────────────────────────────────────

  const handleHire = useCallback(async () => {
    if (!selectedAgent || !agentId) return;
    setHiring(true);
    setPhase('hiring');
    try {
      const result = await hireAgent({
        hirerId: agentId,
        agentId: selectedAgent.agentId,
        jobDescription: transcript,
        agreedPriceUsdc: DEFAULT_BUDGET,
      });

      setCurrentJob({ ...result, jobId: result.jobId });
      setShowConfirm(false);
      addTurn('agent', `Hired ${selectedAgent.name}. Job is in progress.`);
      speak(`Great! I've hired ${selectedAgent.name}. Tracking your job now.`);
      setPhase('executing');

      router.push(`/status/${result.jobId}`);
    } catch (e: any) {
      setError(e.message ?? 'Hire failed');
      speak('Sorry, the hire failed. Please try again.');
    } finally {
      setHiring(false);
    }
  }, [selectedAgent, agentId, transcript]);

  // ── Render ──────────────────────────────────────────────────────────────

  const isIdle     = phase === 'idle' || phase === 'error';
  const isListening = phase === 'listening';
  const isThinking = phase === 'thinking';
  const isConfirming = phase === 'confirming';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Meridian</Text>
          <Pressable onPress={() => router.push('/wallet')} style={styles.walletBtn}>
            <Ionicons name="wallet-outline" size={20} color="#6b7280" />
            <Text style={styles.walletBalance}>
              ${(wallet?.availableUsdc ?? 0).toFixed(2)}
            </Text>
          </Pressable>
        </View>

        {/* State-driven UI */}

        {isThinking && (
          <View style={styles.thinkingRow}>
            <ActivityIndicator color="#6366f1" />
            <Text style={styles.thinkingText}>Finding the best agents…</Text>
          </View>
        )}

        {isConfirming && plan && (
          <>
            <IntentCard plan={plan} transcript={transcript} />

            <Text style={styles.sectionLabel}>
              {plan.candidateAgents.length} agent{plan.candidateAgents.length !== 1 ? 's' : ''} found
            </Text>

            {plan.candidateAgents.map((agent) => (
              <AgentCard
                key={agent.agentId}
                agent={agent}
                selected={selectedAgent?.agentId === agent.agentId}
                onPress={() => selectAgent(agent)}
              />
            ))}

            {plan.candidateAgents.length === 0 && (
              <Text style={styles.noAgents}>
                No matching agents found. Try a different request or register an agent.
              </Text>
            )}

            {selectedAgent && (
              <Pressable
                onPress={() => setShowConfirm(true)}
                style={styles.hireBtn}
              >
                <Ionicons name="flash" size={18} color="#fff" />
                <Text style={styles.hireBtnText}>
                  Hire {selectedAgent.name} — ${DEFAULT_BUDGET} USDC
                </Text>
              </Pressable>
            )}
          </>
        )}

        {phase === 'error' && (
          <View style={styles.errorBox}>
            <Ionicons name="warning-outline" size={18} color="#ef4444" />
            <Text style={styles.errorText}>{useStore.getState().error}</Text>
          </View>
        )}

        {/* Spacer so voice button has room */}
        <View style={{ height: 160 }} />
      </ScrollView>

      {/* Voice button — fixed bottom */}
      <View style={styles.voiceArea}>
        {isIdle && (
          <Text style={styles.voiceHint}>
            {phase === 'error' ? 'Try again' : 'Hold to talk'}
          </Text>
        )}
        {isListening && (
          <Text style={styles.voiceHint}>Listening…</Text>
        )}
        <VoiceButton
          listening={isListening}
          disabled={isThinking || phase === 'hiring' || phase === 'executing'}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        />
        {isConfirming && (
          <Pressable onPress={reset} style={styles.resetBtn}>
            <Text style={styles.resetText}>Start over</Text>
          </Pressable>
        )}
      </View>

      {/* Payment confirm bottom sheet */}
      {showConfirm && selectedAgent && (
        <PaymentConfirm
          visible={showConfirm}
          agent={selectedAgent}
          budgetUsdc={DEFAULT_BUDGET}
          walletBalance={wallet?.availableUsdc ?? 0}
          loading={hiring}
          onConfirm={handleHire}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#080808' },
  scroll:  { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#f9fafb' },
  walletBtn:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  walletBalance: { fontSize: 14, color: '#6b7280' },

  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  thinkingText: { fontSize: 15, color: '#9ca3af' },

  sectionLabel: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  noAgents: {
    fontSize: 14,
    color: '#4b5563',
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 20,
  },

  hireBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#4338ca',
    borderRadius: 14,
    padding: 16,
    marginTop: 8,
  },
  hireBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#1a0a0a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    marginTop: 16,
  },
  errorText: { flex: 1, fontSize: 14, color: '#fca5a5', lineHeight: 20 },

  voiceArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: 44,
    paddingTop: 20,
    backgroundColor: '#080808',
    borderTopWidth: 1,
    borderTopColor: '#111',
  },
  voiceHint: {
    fontSize: 13,
    color: '#4b5563',
    marginBottom: 12,
  },
  resetBtn: { marginTop: 16 },
  resetText: { fontSize: 14, color: '#4b5563' },
});
