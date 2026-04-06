/**
 * _recommendation-surface — plan card shown before confirmation.
 *
 * Displays:
 *   - route summary
 *   - total price
 *   - leg breakdown
 *   - approval badge (auto | confirm | escalate)
 *
 * Used by: converse/index.tsx
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../../lib/theme';
import type { ConciergePlanItem } from '../../../lib/concierge';

export type ApprovalMode = 'auto' | 'human_confirm' | 'escalate'

export type RecommendationProps = {
  plan: ConciergePlanItem[]
  narration: string
  totalAmountGbp: number | null
  approvalMode: ApprovalMode
  approvalReason?: string
  onConfirm: () => void
  onDecline: () => void
}

function ApprovalBadge({ mode, reason }: { mode: ApprovalMode; reason?: string }) {
  if (mode === 'auto') {
    return (
      <View style={styles.badgeAuto}>
        <Ionicons name="checkmark-circle" size={14} color="#4ade80" />
        <Text style={styles.badgeTextAuto}>Auto-booking within your policy</Text>
      </View>
    );
  }

  if (mode === 'escalate') {
    return (
      <View style={styles.badgeEscalate}>
        <Ionicons name="alert-circle" size={14} color="#f87171" />
        <Text style={styles.badgeTextEscalate}>{reason ?? 'Needs your attention'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.badgeConfirm}>
      <Ionicons name="finger-print" size={14} color="#93c5fd" />
      <Text style={styles.badgeTextConfirm}>Confirm to proceed</Text>
    </View>
  );
}

export function RecommendationSurface({
  plan,
  narration,
  totalAmountGbp,
  approvalMode,
  approvalReason,
  onConfirm,
  onDecline,
}: RecommendationProps) {
  if (plan.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.narration}>{narration}</Text>

      {totalAmountGbp != null && totalAmountGbp > 0 && (
        <Text style={styles.price}>£{totalAmountGbp.toFixed(2)}</Text>
      )}

      <ApprovalBadge mode={approvalMode} reason={approvalReason} />

      {approvalMode !== 'auto' && (
        <View style={styles.actions}>
          <Pressable style={styles.confirmButton} onPress={onConfirm}>
            <Text style={styles.confirmText}>Confirm</Text>
          </Pressable>
          <Pressable style={styles.declineButton} onPress={onDecline}>
            <Text style={styles.declineText}>Decline</Text>
          </Pressable>
        </View>
      )}
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
  narration: {
    color: '#f8fafc',
    fontSize: 15,
    lineHeight: 22,
  },
  price: {
    color: '#4ade80',
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  badgeAuto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#052e16',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  badgeTextAuto: {
    color: '#4ade80',
    fontSize: 12,
    fontWeight: '500',
  },
  badgeConfirm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  badgeTextConfirm: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '500',
  },
  badgeEscalate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1c1917',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  badgeTextEscalate: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  confirmButton: {
    flex: 1,
    backgroundColor: '#4ade80',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  confirmText: {
    color: '#052e16',
    fontWeight: '700',
    fontSize: 15,
  },
  declineButton: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  declineText: {
    color: '#94a3b8',
    fontWeight: '500',
    fontSize: 15,
  },
});
