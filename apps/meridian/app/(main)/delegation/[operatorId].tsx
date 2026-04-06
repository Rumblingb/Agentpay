/**
 * delegation/[operatorId] — single operator trust config
 *
 * Shows:
 *   - who the operator is and what they can do
 *   - spend limit (view)
 *   - trip history initiated by this operator
 *   - revoke button
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';

type Operator = {
  operatorId: string
  principalId: string
  type: string
  name: string
  allowedActions: string[]
  spendLimitGbp: number | null
  requiresHumanConfirmAboveGbp: number | null
  delegationExpiresAt: string | null
  revokedAt: string | null
  isActive: boolean
  createdAt: string
}

const ACTION_LABELS: Record<string, string> = {
  plan: 'Plan routes',
  book_rail: 'Book rail',
  book_flight: 'Book flights',
  book_hotel: 'Book hotels',
  cancel: 'Cancel bookings',
  reroute: 'Reroute live journeys',
};

const TYPE_LABELS: Record<string, string> = {
  human: 'Human',
  personal_agent: 'Personal Agent',
  specialist_agent: 'Specialist Agent',
  household_operator: 'Household Operator',
};

export default function OperatorDetailScreen() {
  const { operatorId } = useLocalSearchParams<{ operatorId: string }>();
  const [operator, setOperator] = useState<Operator | null>(null);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorId) return;
    fetch(`${BASE}/ace/operators/${operatorId}`)
      .then((r) => r.json() as Promise<Operator>)
      .then(setOperator)
      .catch(() => setError('Could not load operator details.'))
      .finally(() => setLoading(false));
  }, [operatorId]);

  function confirmRevoke() {
    if (!operator) return;
    Alert.alert(
      'Revoke access',
      `Remove ${operator.name}'s ability to act on your behalf? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            setRevoking(true);
            try {
              await fetch(`${BASE}/ace/operators/${operatorId}`, { method: 'DELETE' });
              router.back();
            } finally {
              setRevoking(false);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#4ade80" style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (error || !operator) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>{error ?? 'Operator not found.'}</Text>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color="#94a3b8" />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{operator.name}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Identity */}
        <View style={styles.section}>
          <View style={styles.identityRow}>
            <View style={styles.identityLeft}>
              <Text style={styles.operatorName}>{operator.name}</Text>
              <Text style={styles.operatorType}>{TYPE_LABELS[operator.type] ?? operator.type}</Text>
            </View>
            <View style={[styles.statusBadge, operator.isActive ? styles.activeBadge : styles.inactiveBadge]}>
              <Text style={[styles.statusText, operator.isActive ? styles.activeText : styles.inactiveText]}>
                {operator.isActive ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </View>
        </View>

        {/* Spend limits */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Spend authority</Text>
          {operator.spendLimitGbp != null ? (
            <View style={styles.limitRow}>
              <Ionicons name="card-outline" size={16} color="#94a3b8" />
              <Text style={styles.limitText}>
                Up to £{operator.spendLimitGbp} per booking
              </Text>
            </View>
          ) : (
            <Text style={styles.metaText}>No spend limit set — policy limits apply</Text>
          )}
          {operator.requiresHumanConfirmAboveGbp != null && (
            <View style={styles.limitRow}>
              <Ionicons name="finger-print" size={16} color="#93c5fd" />
              <Text style={styles.limitText}>
                Your confirmation required above £{operator.requiresHumanConfirmAboveGbp}
              </Text>
            </View>
          )}
        </View>

        {/* Allowed actions */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>What they can do</Text>
          {operator.allowedActions.length === 0 ? (
            <Text style={styles.metaText}>No actions granted</Text>
          ) : (
            <View style={styles.actionsList}>
              {operator.allowedActions.map((action) => (
                <View key={action} style={styles.actionRow}>
                  <Ionicons name="checkmark" size={14} color="#4ade80" />
                  <Text style={styles.actionText}>
                    {ACTION_LABELS[action] ?? action}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Expiry */}
        {operator.delegationExpiresAt && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Delegation expires</Text>
            <Text style={styles.metaText}>
              {new Date(operator.delegationExpiresAt).toLocaleDateString()}
            </Text>
          </View>
        )}

        {/* Revoke */}
        {operator.isActive && (
          <View style={[styles.section, { marginTop: 8 }]}>
            <Pressable
              style={[styles.revokeButton, revoking && styles.disabled]}
              onPress={confirmRevoke}
              disabled={revoking}
            >
              {revoking ? (
                <ActivityIndicator color="#f87171" />
              ) : (
                <>
                  <Ionicons name="ban" size={16} color="#f87171" />
                  <Text style={styles.revokeText}>Revoke access</Text>
                </>
              )}
            </Pressable>
            <Text style={styles.revokeCaption}>
              Removing access cannot be undone. You can re-grant it later.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: { color: '#f8fafc', fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'center', marginHorizontal: 12 },
  content: { padding: 20, gap: 4 },
  section: {
    backgroundColor: '#0b1220',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    marginBottom: 12,
    gap: 10,
  },
  sectionLabel: { color: '#64748b', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  identityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  identityLeft: { gap: 4 },
  operatorName: { color: '#f8fafc', fontSize: 18, fontWeight: '700' },
  operatorType: { color: '#94a3b8', fontSize: 13 },
  statusBadge: { borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10 },
  activeBadge: { backgroundColor: '#052e16' },
  inactiveBadge: { backgroundColor: '#1e293b' },
  statusText: { fontSize: 12, fontWeight: '600' },
  activeText: { color: '#4ade80' },
  inactiveText: { color: '#64748b' },
  limitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  limitText: { color: '#cbd5e1', fontSize: 14 },
  metaText: { color: '#64748b', fontSize: 14 },
  actionsList: { gap: 8 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionText: { color: '#94a3b8', fontSize: 14 },
  revokeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1c1917',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#92400e',
    paddingVertical: 14,
  },
  revokeText: { color: '#f87171', fontWeight: '600', fontSize: 15 },
  revokeCaption: { color: '#475569', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  disabled: { opacity: 0.5 },
  backButton: { padding: 20, alignItems: 'center' },
  backButtonText: { color: '#64748b', fontSize: 14 },
  errorText: { color: '#f87171', fontSize: 16, textAlign: 'center', padding: 24 },
});
