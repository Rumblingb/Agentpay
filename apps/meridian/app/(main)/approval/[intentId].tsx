/**
 * approval/[intentId] — approval card
 *
 * Three states based on ApprovalDecision.requiredFrom:
 *   policy_auto   → "Ace is booking this automatically."
 *   human_confirm → "Ace recommends this route. Confirm to proceed."
 *   escalate      → "This needs your attention."
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';

type ApprovalMode = 'auto' | 'human_confirm' | 'escalate'
type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'escalated'

type ApprovalState = {
  intentId: string
  approvalId: string
  mode: ApprovalMode
  requiredFrom: 'human' | 'agent' | 'policy_auto'
  reason: string
  status: ApprovalStatus
  recommendation: {
    summary: string
    totalAmountGbp: number
  } | null
}

export default function ApprovalScreen() {
  const { intentId } = useLocalSearchParams<{ intentId: string }>();
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(false);
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!intentId) return;
    fetch(`${BASE}/ace/intents/${intentId}`)
      .then((r) => r.json())
      .then((data: {
        intentId: string;
        status: string;
        objective: string;
        constraints?: { budgetMax?: number };
      }) => {
        // Load plan/approval details from intent
        setApproval({
          intentId: data.intentId,
          approvalId: '',
          mode: 'human_confirm',
          requiredFrom: 'human',
          reason: 'Review and confirm this trip.',
          status: 'pending',
          recommendation: {
            summary: data.objective,
            totalAmountGbp: data.constraints?.budgetMax
              ? data.constraints.budgetMax / 100
              : 0,
          },
        });
      })
      .catch(() => setError('Could not load this approval.'))
      .finally(() => setLoading(false));
  }, [intentId]);

  async function decide(decision: 'approved' | 'rejected') {
    if (!intentId || !approval) return;
    setDeciding(true);
    try {
      const res = await fetch(`${BASE}/ace/intents/${intentId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: 'human', decision }),
      });
      const data = await res.json() as { status: string; approvalId: string };
      if (decision === 'approved') {
        // Trigger execution
        await fetch(`${BASE}/ace/intents/${intentId}/execute`, { method: 'POST' });
        router.replace('/(main)/converse');
      } else {
        router.back();
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setDeciding(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#4ade80" />
      </SafeAreaView>
    );
  }

  if (error || !approval) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>{error ?? 'Something went wrong.'}</Text>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // Auto-approval state
  if (approval.mode === 'auto' || approval.requiredFrom === 'policy_auto') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.iconRow}>
            <Ionicons name="checkmark-circle" size={40} color="#4ade80" />
          </View>
          <Text style={styles.headline}>Ace is booking this automatically.</Text>
          {approval.recommendation && (
            <Text style={styles.summary}>{approval.recommendation.summary}</Text>
          )}
          <View style={styles.policyNote}>
            <Ionicons name="shield-checkmark-outline" size={14} color="#94a3b8" />
            <Text style={styles.policyText}>{approval.reason}</Text>
          </View>
          <Pressable style={styles.backButton} onPress={() => router.replace('/(main)/converse')}>
            <Text style={styles.backButtonText}>Back to Ace</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Escalation state
  if (approval.mode === 'escalate') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.iconRow}>
            <Ionicons name="alert-circle" size={40} color="#f87171" />
          </View>
          <Text style={styles.headline}>This needs your attention.</Text>
          <View style={styles.reasonCard}>
            <Text style={styles.reasonText}>{approval.reason}</Text>
          </View>
          <Pressable
            style={styles.supportButton}
            onPress={() => router.push('/(main)/settings')}
          >
            <Text style={styles.supportButtonText}>Get support</Text>
          </Pressable>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go back</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Human confirm state
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconRow}>
          <Ionicons name="finger-print" size={40} color="#93c5fd" />
        </View>
        <Text style={styles.headline}>Ace recommends this route.</Text>
        {approval.recommendation && (
          <>
            <Text style={styles.summary}>{approval.recommendation.summary}</Text>
            {approval.recommendation.totalAmountGbp > 0 && (
              <Text style={styles.price}>
                £{approval.recommendation.totalAmountGbp.toFixed(2)}
              </Text>
            )}
          </>
        )}
        <View style={styles.reasonCard}>
          <Text style={styles.reasonText}>{approval.reason}</Text>
        </View>
        <View style={styles.actions}>
          <Pressable
            style={[styles.confirmButton, deciding && styles.disabled]}
            onPress={() => decide('approved')}
            disabled={deciding}
          >
            {deciding ? (
              <ActivityIndicator color="#052e16" />
            ) : (
              <Text style={styles.confirmText}>Confirm</Text>
            )}
          </Pressable>
          <Pressable
            style={[styles.declineButton, deciding && styles.disabled]}
            onPress={() => decide('rejected')}
            disabled={deciding}
          >
            <Text style={styles.declineText}>Decline</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  content: { padding: 24, gap: 16, alignItems: 'center' },
  iconRow: { marginTop: 24, marginBottom: 8 },
  headline: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  summary: {
    color: '#94a3b8',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  price: {
    color: '#4ade80',
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: -1,
  },
  policyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0b1220',
    borderRadius: 8,
    padding: 12,
    width: '100%',
  },
  policyText: { color: '#94a3b8', fontSize: 13, flex: 1 },
  reasonCard: {
    backgroundColor: '#0b1220',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
    width: '100%',
  },
  reasonText: { color: '#cbd5e1', fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 12, width: '100%', marginTop: 8 },
  confirmButton: {
    flex: 1,
    backgroundColor: '#4ade80',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmText: { color: '#052e16', fontWeight: '700', fontSize: 16 },
  declineButton: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  declineText: { color: '#94a3b8', fontWeight: '500', fontSize: 16 },
  supportButton: {
    backgroundColor: '#1c1917',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#92400e',
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    width: '100%',
  },
  supportButtonText: { color: '#f87171', fontWeight: '600', fontSize: 15 },
  backButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  backButtonText: { color: '#64748b', fontSize: 14 },
  errorText: { color: '#f87171', fontSize: 16, textAlign: 'center', padding: 24 },
  disabled: { opacity: 0.5 },
});
