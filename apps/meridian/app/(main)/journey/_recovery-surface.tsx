/**
 * _recovery-surface — escalation and support surface for a live journey.
 *
 * Shown when bookingState = 'attention_required' or a disruption cannot
 * be auto-resolved.
 *
 * Provides:
 *   - clear status explanation
 *   - contact support
 *   - report issue
 *   - escalate to manual handling
 *
 * Used by: journey/[intentId].tsx
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';

export type RecoverySurfaceProps = {
  intentId: string
  reason?: string
  onResolved?: () => void
}

export function RecoverySurface({ intentId, reason, onResolved }: RecoverySurfaceProps) {
  const [issueText, setIssueText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submitIssue() {
    if (!issueText.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`${BASE}/api/support`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intentId,
          issue: issueText.trim(),
          context: 'journey_recovery',
        }),
      });
      setSubmitted(true);
      setIssueText('');
      onResolved?.();
    } catch {
      Alert.alert('Could not send', 'Please try again or contact support directly.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="checkmark-circle" size={20} color="#4ade80" />
          <Text style={styles.headerText}>Ace has this.</Text>
        </View>
        <Text style={styles.body}>
          Your message has been received. Ace's team will handle this and keep you updated.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="alert-circle" size={20} color="#f87171" />
        <Text style={styles.headerText}>This trip needs attention.</Text>
      </View>

      {reason && (
        <Text style={styles.reason}>{reason}</Text>
      )}

      <Text style={styles.prompt}>
        Tell Ace what happened and what you need. We'll handle the rest.
      </Text>

      <TextInput
        style={styles.input}
        value={issueText}
        onChangeText={setIssueText}
        placeholder="e.g. Train cancelled, need to get to Edinburgh before 4pm…"
        placeholderTextColor="#475569"
        multiline
        numberOfLines={3}
      />

      <Pressable
        style={[styles.submitButton, (!issueText.trim() || submitting) && styles.disabled]}
        onPress={submitIssue}
        disabled={!issueText.trim() || submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#f8fafc" />
        ) : (
          <Text style={styles.submitText}>Send to Ace support</Text>
        )}
      </Pressable>

      <View style={styles.alternatives}>
        <Text style={styles.alternativesLabel}>Other options</Text>
        <Pressable
          style={styles.alternativeRow}
          onPress={() => {
            Alert.alert(
              'Manual reroute',
              'Ace can rebuild your journey. Describe your new destination and time constraint.',
            );
          }}
        >
          <Ionicons name="map-outline" size={16} color="#94a3b8" />
          <Text style={styles.alternativeText}>Request manual reroute</Text>
        </Pressable>
        <Pressable
          style={styles.alternativeRow}
          onPress={() => {
            Alert.alert(
              'Cancel and refund',
              'If you need to cancel, Ace will attempt to secure a refund. Confirm?',
              [
                { text: 'Keep journey', style: 'cancel' },
                {
                  text: 'Cancel booking',
                  style: 'destructive',
                  onPress: () => {
                    // Cancellation handled in journey screen
                  },
                },
              ],
            );
          }}
        >
          <Ionicons name="close-circle-outline" size={16} color="#94a3b8" />
          <Text style={styles.alternativeText}>Cancel and request refund</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0b1220',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerText: {
    color: '#f87171',
    fontSize: 15,
    fontWeight: '600',
  },
  reason: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
    backgroundColor: '#1c1917',
    borderRadius: 8,
    padding: 10,
  },
  prompt: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    backgroundColor: '#111827',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    color: '#f8fafc',
    fontSize: 14,
    padding: 12,
    textAlignVertical: 'top',
    minHeight: 80,
  },
  submitButton: {
    backgroundColor: '#1e3a5f',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  submitText: { color: '#93c5fd', fontWeight: '600', fontSize: 14 },
  disabled: { opacity: 0.4 },
  alternatives: { gap: 8, marginTop: 4 },
  alternativesLabel: { color: '#475569', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  alternativeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  alternativeText: { color: '#94a3b8', fontSize: 13 },
});
