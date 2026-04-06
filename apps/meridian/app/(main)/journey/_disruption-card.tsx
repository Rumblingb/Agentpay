/**
 * _disruption-card — shown during a live journey when a disruption is detected.
 *
 * Displays:
 *   - disruption description
 *   - reroute options with price and approval badge
 *   - action buttons: accept reroute / dismiss / get support
 *
 * Used by: journey/[intentId].tsx
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type RerouteOption = {
  summary: string
  totalAmountGbp: number
  approvalRequired: boolean
  approvalReason?: string
}

export type DisruptionCardProps = {
  disruption: string
  rerouteOptions: RerouteOption[]
  onSelectReroute: (option: RerouteOption, index: number) => void
  onDismiss: () => void
  onSupport: () => void
}

export function DisruptionCard({
  disruption,
  rerouteOptions,
  onSelectReroute,
  onDismiss,
  onSupport,
}: DisruptionCardProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="warning" size={18} color="#fbbf24" />
        <Text style={styles.headerText}>Disruption detected</Text>
      </View>

      <Text style={styles.disruption}>{disruption}</Text>

      {rerouteOptions.length > 0 && (
        <View style={styles.options}>
          <Text style={styles.optionsLabel}>Ace found {rerouteOptions.length === 1 ? 'an alternative' : 'alternatives'}:</Text>
          {rerouteOptions.map((option, i) => (
            <Pressable
              key={i}
              style={styles.optionCard}
              onPress={() => onSelectReroute(option, i)}
            >
              <View style={styles.optionTop}>
                <Text style={styles.optionSummary}>{option.summary}</Text>
                <Text style={styles.optionPrice}>£{option.totalAmountGbp.toFixed(2)}</Text>
              </View>
              {option.approvalRequired && (
                <View style={styles.approvalBadge}>
                  <Ionicons name="finger-print" size={12} color="#93c5fd" />
                  <Text style={styles.approvalText}>
                    {option.approvalReason ?? 'Requires your confirmation'}
                  </Text>
                </View>
              )}
              <View style={styles.rerouteAction}>
                <Text style={styles.rerouteActionText}>Take this route →</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.actions}>
        <Pressable style={styles.supportButton} onPress={onSupport}>
          <Ionicons name="headset-outline" size={14} color="#94a3b8" />
          <Text style={styles.supportText}>Get support</Text>
        </Pressable>
        <Pressable style={styles.dismissButton} onPress={onDismiss}>
          <Text style={styles.dismissText}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1c1917',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#92400e',
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerText: {
    color: '#fbbf24',
    fontSize: 14,
    fontWeight: '600',
  },
  disruption: {
    color: '#fef3c7',
    fontSize: 14,
    lineHeight: 20,
  },
  options: { gap: 10 },
  optionsLabel: { color: '#94a3b8', fontSize: 13 },
  optionCard: {
    backgroundColor: '#0b1220',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
    gap: 8,
  },
  optionTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  optionSummary: { color: '#f8fafc', fontSize: 14, flex: 1, marginRight: 8 },
  optionPrice: { color: '#4ade80', fontSize: 16, fontWeight: '600' },
  approvalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0f172a',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },
  approvalText: { color: '#93c5fd', fontSize: 11 },
  rerouteAction: { alignSelf: 'flex-end' },
  rerouteActionText: { color: '#4ade80', fontSize: 13, fontWeight: '500' },
  actions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  supportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  supportText: { color: '#94a3b8', fontSize: 13 },
  dismissButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  dismissText: { color: '#475569', fontSize: 13 },
});
