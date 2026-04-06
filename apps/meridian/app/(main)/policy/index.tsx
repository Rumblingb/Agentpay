/**
 * policy/index — principal's travel constitution
 *
 * The human's travel constitution. Controls:
 *   - Auto-book rail under £X
 *   - Always ask for flights
 *   - Preferred class
 *   - Max arrival hour
 *   - Operator permissions (links to delegation/)
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../../../lib/store';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.agentpay.so';

type Policy = {
  policyId: string
  autoBookRailUnderGbp: number | null
  autoBookHotelUnderGbp: number | null
  requireHumanApprovalForFlights: boolean
  maxArrivalHour: number | null
  preferDirect: boolean
  preferredClass: 'standard' | 'first'
  preferredSeat: 'window' | 'aisle' | 'any'
}

const RAIL_LIMITS = [0, 20, 40, 60, 80, 100, 150, 200];
const ARRIVAL_HOURS = [20, 21, 22, 23];

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function SettingRow({
  label,
  detail,
  children,
}: {
  label: string
  detail?: string
  children: React.ReactNode
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingLeft}>
        <Text style={styles.settingLabel}>{label}</Text>
        {detail && <Text style={styles.settingDetail}>{detail}</Text>}
      </View>
      {children}
    </View>
  );
}

export default function PolicyScreen() {
  const { agentId } = useStore();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [principalId, setPrincipalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      // Find principal for this agent
      const pRes = await fetch(`${BASE}/ace/principals?agentId=${agentId}`);
      if (!pRes.ok) {
        setLoading(false);
        return;
      }
      const { principalId: pid } = await pRes.json() as { principalId: string };
      setPrincipalId(pid);

      const polRes = await fetch(`${BASE}/ace/principals/${pid}/policy`);
      if (!polRes.ok) {
        setLoading(false);
        return;
      }
      const data = await polRes.json() as Policy;
      setPolicy(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function save(patch: Partial<Policy>) {
    if (!principalId || !policy) return;
    const updated = { ...policy, ...patch };
    setPolicy(updated);
    setSaving(true);
    try {
      await fetch(`${BASE}/ace/principals/${principalId}/policy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoBookRailUnderGbp: updated.autoBookRailUnderGbp,
          requireHumanApprovalForFlights: updated.requireHumanApprovalForFlights,
          maxArrivalHour: updated.maxArrivalHour,
          preferDirect: updated.preferDirect,
          preferredClass: updated.preferredClass,
        }),
      });
    } catch {
      Alert.alert('Could not save', 'Your policy update did not save. Please try again.');
      setPolicy(policy); // revert
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color="#94a3b8" />
          </Pressable>
          <Text style={styles.title}>Travel policy</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator color="#4ade80" />
        </View>
      </SafeAreaView>
    );
  }

  if (!policy) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color="#94a3b8" />
          </Pressable>
          <Text style={styles.title}>Travel policy</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.emptyBody}>
            No policy found. Complete onboarding to create your travel profile.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color="#94a3b8" />
        </Pressable>
        <Text style={styles.title}>Travel policy</Text>
        {saving ? (
          <ActivityIndicator size="small" color="#4ade80" />
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Your travel constitution. Ace uses this to decide what it can do automatically
          and what needs your confirmation.
        </Text>

        {/* Booking automation */}
        <SectionHeader title="Booking automation" />
        <View style={styles.card}>
          <SettingRow
            label="Auto-book rail under"
            detail={
              policy.autoBookRailUnderGbp
                ? `Ace books rail automatically up to £${policy.autoBookRailUnderGbp}`
                : 'Always ask before booking rail'
            }
          >
            <View style={styles.chipRow}>
              {RAIL_LIMITS.map((limit) => (
                <Pressable
                  key={limit}
                  style={[
                    styles.chip,
                    (policy.autoBookRailUnderGbp ?? 0) === limit && styles.chipActive,
                  ]}
                  onPress={() => save({ autoBookRailUnderGbp: limit === 0 ? null : limit })}
                >
                  <Text
                    style={[
                      styles.chipText,
                      (policy.autoBookRailUnderGbp ?? 0) === limit && styles.chipTextActive,
                    ]}
                  >
                    {limit === 0 ? 'Off' : `£${limit}`}
                  </Text>
                </Pressable>
              ))}
            </View>
          </SettingRow>
        </View>

        {/* Flights */}
        <SectionHeader title="Flights" />
        <View style={styles.card}>
          <SettingRow
            label="Always confirm flights"
            detail="Ace will always ask before booking any flight"
          >
            <Switch
              value={policy.requireHumanApprovalForFlights}
              onValueChange={(v) => save({ requireHumanApprovalForFlights: v })}
              trackColor={{ false: '#1e293b', true: '#166534' }}
              thumbColor={policy.requireHumanApprovalForFlights ? '#4ade80' : '#64748b'}
            />
          </SettingRow>
        </View>

        {/* Journey preferences */}
        <SectionHeader title="Journey preferences" />
        <View style={styles.card}>
          <SettingRow
            label="Prefer direct routes"
            detail="Avoid connections when a direct option exists"
          >
            <Switch
              value={policy.preferDirect}
              onValueChange={(v) => save({ preferDirect: v })}
              trackColor={{ false: '#1e293b', true: '#166534' }}
              thumbColor={policy.preferDirect ? '#4ade80' : '#64748b'}
            />
          </SettingRow>

          <View style={styles.divider} />

          <SettingRow
            label="Preferred class"
            detail={policy.preferredClass === 'first' ? 'First class' : 'Standard class'}
          >
            <View style={styles.segmented}>
              {(['standard', 'first'] as const).map((cls) => (
                <Pressable
                  key={cls}
                  style={[styles.segment, policy.preferredClass === cls && styles.segmentActive]}
                  onPress={() => save({ preferredClass: cls })}
                >
                  <Text style={[styles.segmentText, policy.preferredClass === cls && styles.segmentTextActive]}>
                    {cls === 'first' ? 'First' : 'Standard'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </SettingRow>

          <View style={styles.divider} />

          <SettingRow
            label="Avoid late arrivals after"
            detail={policy.maxArrivalHour ? `${policy.maxArrivalHour}:00` : 'No limit set'}
          >
            <View style={styles.chipRow}>
              <Pressable
                style={[styles.chip, !policy.maxArrivalHour && styles.chipActive]}
                onPress={() => save({ maxArrivalHour: null })}
              >
                <Text style={[styles.chipText, !policy.maxArrivalHour && styles.chipTextActive]}>Off</Text>
              </Pressable>
              {ARRIVAL_HOURS.map((h) => (
                <Pressable
                  key={h}
                  style={[styles.chip, policy.maxArrivalHour === h && styles.chipActive]}
                  onPress={() => save({ maxArrivalHour: h })}
                >
                  <Text style={[styles.chipText, policy.maxArrivalHour === h && styles.chipTextActive]}>
                    {h}:00
                  </Text>
                </Pressable>
              ))}
            </View>
          </SettingRow>
        </View>

        {/* Trusted operators */}
        <SectionHeader title="Trusted operators" />
        <Pressable
          style={styles.linkCard}
          onPress={() => router.push('/(main)/delegation')}
        >
          <View style={styles.linkCardLeft}>
            <Text style={styles.linkCardTitle}>Manage trusted operators</Text>
            <Text style={styles.linkCardDetail}>
              Agents and people you trust to act on your behalf
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#64748b" />
        </Pressable>
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
  title: { color: '#f8fafc', fontSize: 16, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  content: { padding: 20, gap: 4 },
  intro: { color: '#64748b', fontSize: 14, lineHeight: 20, marginBottom: 8 },
  sectionHeader: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#0b1220',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginBottom: 4,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    gap: 12,
  },
  settingLeft: { flex: 1, gap: 2 },
  settingLabel: { color: '#f8fafc', fontSize: 14, fontWeight: '500' },
  settingDetail: { color: '#64748b', fontSize: 12 },
  divider: { height: 1, backgroundColor: '#1e293b', marginHorizontal: -16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' },
  chip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#111827',
  },
  chipActive: { borderColor: '#4ade80', backgroundColor: '#052e16' },
  chipText: { color: '#64748b', fontSize: 12, fontWeight: '500' },
  chipTextActive: { color: '#4ade80' },
  segmented: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    overflow: 'hidden',
  },
  segment: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#111827' },
  segmentActive: { backgroundColor: '#1e40af' },
  segmentText: { color: '#64748b', fontSize: 12, fontWeight: '500' },
  segmentTextActive: { color: '#93c5fd' },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0b1220',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    gap: 12,
  },
  linkCardLeft: { flex: 1, gap: 4 },
  linkCardTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '500' },
  linkCardDetail: { color: '#64748b', fontSize: 12 },
  emptyBody: { color: '#64748b', fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
