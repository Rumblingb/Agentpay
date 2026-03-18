/**
 * PaymentConfirm — bottom sheet modal for approving a hire + payment
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { Agent } from '../lib/api';

interface Props {
  visible: boolean;
  agent: Agent;
  budgetUsdc: number;
  walletBalance: number;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PaymentConfirm({
  visible,
  agent,
  budgetUsdc,
  walletBalance,
  loading,
  onConfirm,
  onCancel,
}: Props) {
  const fee = parseFloat((budgetUsdc * 0.05).toFixed(2));
  const agentPayout = parseFloat((budgetUsdc - fee).toFixed(2));
  const canPay = walletBalance >= budgetUsdc;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={styles.sheet}>
        {/* Handle */}
        <View style={styles.handle} />

        <Text style={styles.title}>Approve & Hire</Text>

        {/* Agent summary */}
        <View style={styles.agentRow}>
          <View style={styles.agentAvatar}>
            <Ionicons name="hardware-chip-outline" size={22} color="#6366f1" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.agentName}>{agent.name}</Text>
            <Text style={styles.agentCat}>{agent.category}</Text>
          </View>
          <View style={styles.trustBadge}>
            <Text style={styles.trustText}>{agent.grade}</Text>
          </View>
        </View>

        {/* Payment breakdown */}
        <View style={styles.breakdown}>
          <Row label="Task fee" value={`$${budgetUsdc} USDC`} />
          <Row label="Platform (5%)" value={`-$${fee} USDC`} muted />
          <Row label="Agent receives" value={`$${agentPayout} USDC`} />
          <View style={styles.divider} />
          <Row label="Wallet balance" value={`$${walletBalance.toFixed(2)} USDC`}
            valueColor={canPay ? '#22c55e' : '#ef4444'} />
        </View>

        {!canPay && (
          <View style={styles.warning}>
            <Ionicons name="warning-outline" size={14} color="#f59e0b" />
            <Text style={styles.warningText}>
              Insufficient balance. Deposit USDC to your hosted wallet first.
            </Text>
          </View>
        )}

        {/* Actions */}
        <Pressable
          onPress={onConfirm}
          disabled={loading || !canPay}
          style={{ marginTop: 16 }}
        >
          <LinearGradient
            colors={canPay ? ['#4338ca', '#6366f1'] : ['#1f1f1f', '#2a2a2a']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.confirmBtn, (!canPay || loading) && { opacity: 0.6 }]}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="flash" size={18} color="#fff" />
                <Text style={styles.confirmText}>
                  {canPay ? `Hire for $${budgetUsdc} USDC` : 'Insufficient balance'}
                </Text>
              </>
            )}
          </LinearGradient>
        </Pressable>

        <Pressable onPress={onCancel} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function Row({
  label,
  value,
  muted,
  valueColor,
}: {
  label: string;
  value: string;
  muted?: boolean;
  valueColor?: string;
}) {
  return (
    <View style={rowStyles.row}>
      <Text style={[rowStyles.label, muted && rowStyles.muted]}>{label}</Text>
      <Text style={[rowStyles.value, muted && rowStyles.muted, valueColor ? { color: valueColor } : {}]}>
        {value}
      </Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  label: { fontSize: 14, color: '#9ca3af' },
  value: { fontSize: 14, color: '#f9fafb', fontWeight: '500' },
  muted: { color: '#4b5563' },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  sheet: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderColor: '#1f1f1f',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#374151',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f9fafb',
    marginBottom: 18,
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
  },
  agentAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1e1b4b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentName: { fontSize: 15, fontWeight: '600', color: '#f9fafb' },
  agentCat:  { fontSize: 12, color: '#6b7280', marginTop: 2 },
  trustBadge: {
    backgroundColor: '#1e1b4b',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  trustText: { fontSize: 13, color: '#818cf8', fontWeight: '700' },
  breakdown: {
    backgroundColor: '#0d0d0d',
    borderRadius: 12,
    padding: 14,
    marginBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#1f1f1f',
    marginVertical: 8,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1c1507',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#92400e',
  },
  warningText: { flex: 1, fontSize: 12, color: '#fbbf24', lineHeight: 16 },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    padding: 16,
  },
  confirmText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  cancelBtn: { alignItems: 'center', marginTop: 12, padding: 8 },
  cancelText: { fontSize: 14, color: '#6b7280' },
});
