/**
 * IntentCard — shows the parsed intent + detected capabilities
 * Appears after voice input is transcribed and coordinated.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CoordinationPlan } from '../lib/api';

const CAPABILITY_ICONS: Record<string, string> = {
  flight_booking:  '✈️',
  hotel_booking:   '🏨',
  transport:       '🚗',
  research:        '🔍',
  writing:         '✍️',
  code:            '💻',
  image_generation:'🎨',
  data_analysis:   '📊',
  translation:     '🌐',
  summarization:   '📝',
};

interface Props {
  plan: CoordinationPlan;
  transcript: string;
}

export function IntentCard({ plan, transcript }: Props) {
  return (
    <View style={styles.card}>
      {/* What you said */}
      <View style={styles.quoteRow}>
        <Ionicons name="mic" size={14} color="#6b7280" />
        <Text style={styles.quote} numberOfLines={2}>{transcript}</Text>
      </View>

      {/* Detected capabilities */}
      {plan.detectedCapabilities.length > 0 && (
        <View style={styles.capsRow}>
          {plan.detectedCapabilities.map((cap) => (
            <View key={cap} style={styles.capChip}>
              <Text style={styles.capEmoji}>
                {CAPABILITY_ICONS[cap] ?? '🤖'}
              </Text>
              <Text style={styles.capLabel}>
                {cap.replace(/_/g, ' ')}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Budget */}
      {plan.budget != null && (
        <View style={styles.budgetRow}>
          <Ionicons name="wallet-outline" size={13} color="#6b7280" />
          <Text style={styles.budgetText}>Budget: ${plan.budget} USDC</Text>
        </View>
      )}

      {/* Step plan */}
      {plan.steps.length > 1 && (
        <View style={styles.steps}>
          {plan.steps.map((step) => (
            <View key={step.step} style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{step.step}</Text>
              </View>
              <Text style={styles.stepLabel}>
                {step.capability.replace(/_/g, ' ')}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0f0f1a',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2d2b69',
    marginBottom: 16,
  },
  quoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 12,
  },
  quote: {
    flex: 1,
    fontSize: 14,
    color: '#c7d2fe',
    fontStyle: 'italic',
    lineHeight: 20,
  },
  capsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  capChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1e1b4b',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#3730a3',
  },
  capEmoji: { fontSize: 13 },
  capLabel: { fontSize: 12, color: '#a5b4fc', fontWeight: '500' },
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 10,
  },
  budgetText: { fontSize: 12, color: '#6b7280' },
  steps: { gap: 6, marginTop: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#312e81',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { fontSize: 11, color: '#a5b4fc', fontWeight: '700' },
  stepLabel: { fontSize: 13, color: '#9ca3af' },
});
