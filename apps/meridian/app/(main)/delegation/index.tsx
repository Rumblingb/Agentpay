/**
 * delegation/index — trusted operators list
 *
 * Shows all operators the principal has granted delegation to.
 * Each row shows: name, type badge, spend limit, allowed actions, revoke button.
 */

import React, { useCallback, useEffect, useState } from 'react';
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
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../../../lib/store';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';

type Operator = {
  operatorId: string
  name: string
  type: string
  allowedActions: string[]
  spendLimitGbp: number | null
  isActive: boolean
  delegationExpiresAt: string | null
  createdAt: string
}

const TYPE_LABELS: Record<string, string> = {
  human: 'Human',
  personal_agent: 'Personal Agent',
  specialist_agent: 'Specialist Agent',
  household_operator: 'Household',
};

function TypeBadge({ type }: { type: string }) {
  return (
    <View style={styles.typeBadge}>
      <Text style={styles.typeBadgeText}>{TYPE_LABELS[type] ?? type}</Text>
    </View>
  );
}

export default function DelegationScreen() {
  const { agentId } = useStore();
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      // Load principal by agentId
      const pRes = await fetch(`${BASE}/ace/principals?agentId=${agentId}`);
      if (!pRes.ok) return;
      const { principalId } = await pRes.json() as { principalId: string };

      const res = await fetch(`${BASE}/ace/principals/${principalId}`);
      if (!res.ok) return;
      const { trustedOperatorIds } = await res.json() as { trustedOperatorIds: string[] };

      const ops = await Promise.all(
        (trustedOperatorIds ?? []).map((id) =>
          fetch(`${BASE}/ace/operators/${id}`)
            .then((r) => r.json() as Promise<Operator>)
            .catch(() => null),
        ),
      );

      setOperators(ops.filter((o): o is Operator => o != null));
    } catch {
      // silently fail — operators will be empty
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function revoke(operatorId: string, name: string) {
    Alert.alert(
      'Revoke access',
      `Remove ${name}'s ability to act on your behalf?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            setRevoking(operatorId);
            try {
              await fetch(`${BASE}/ace/operators/${operatorId}`, { method: 'DELETE' });
              setOperators((prev) => prev.filter((o) => o.operatorId !== operatorId));
            } finally {
              setRevoking(null);
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color="#94a3b8" />
        </Pressable>
        <Text style={styles.title}>Trusted operators</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#4ade80" />
        </View>
      ) : operators.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={40} color="#334155" />
          <Text style={styles.emptyTitle}>No trusted operators</Text>
          <Text style={styles.emptyBody}>
            Agents or people you trust can be granted access to plan and book on your behalf.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {operators.map((op) => (
            <Pressable
              key={op.operatorId}
              style={styles.card}
              onPress={() =>
                router.push({
                  pathname: '/(main)/delegation/[operatorId]',
                  params: { operatorId: op.operatorId },
                })
              }
            >
              <View style={styles.cardTop}>
                <View style={styles.cardLeft}>
                  <Text style={styles.operatorName}>{op.name}</Text>
                  <TypeBadge type={op.type} />
                </View>
                {op.isActive ? (
                  <View style={styles.activeDot} />
                ) : (
                  <View style={styles.inactiveDot} />
                )}
              </View>

              <View style={styles.cardMeta}>
                {op.spendLimitGbp != null && (
                  <Text style={styles.metaText}>Limit: £{op.spendLimitGbp}</Text>
                )}
                {op.allowedActions.length > 0 && (
                  <Text style={styles.metaText}>
                    {op.allowedActions.join(', ')}
                  </Text>
                )}
              </View>

              <Pressable
                style={styles.revokeButton}
                onPress={(e) => { e.stopPropagation(); revoke(op.operatorId, op.name); }}
                disabled={revoking === op.operatorId}
              >
                {revoking === op.operatorId ? (
                  <ActivityIndicator size="small" color="#f87171" />
                ) : (
                  <Text style={styles.revokeText}>Revoke</Text>
                )}
              </Pressable>
            </Pressable>
          ))}
        </ScrollView>
      )}
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
  title: { color: '#f8fafc', fontSize: 16, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyTitle: { color: '#cbd5e1', fontSize: 16, fontWeight: '600' },
  emptyBody: { color: '#64748b', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#0b1220',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    gap: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardLeft: { gap: 6 },
  operatorName: { color: '#f8fafc', fontSize: 16, fontWeight: '600' },
  typeBadge: {
    backgroundColor: '#1e293b',
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },
  typeBadgeText: { color: '#94a3b8', fontSize: 11, fontWeight: '500' },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ade80', marginTop: 4 },
  inactiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#475569', marginTop: 4 },
  cardMeta: { gap: 4 },
  metaText: { color: '#64748b', fontSize: 13 },
  revokeButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#92400e',
  },
  revokeText: { color: '#f87171', fontSize: 13, fontWeight: '500' },
});
