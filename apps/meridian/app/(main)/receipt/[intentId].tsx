/**
 * Receipt screen — signed settlement proof
 * Clean, premium design. Shareable.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { getReceipt, type Receipt } from '../../../lib/api';
import { useStore } from '../../../lib/store';

export default function ReceiptScreen() {
  const { intentId } = useLocalSearchParams<{ intentId: string }>();
  const { reset, currentAgent } = useStore();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!intentId) return;
    getReceipt(intentId)
      .then(setReceipt)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [intentId]);

  const handleShare = async () => {
    if (!receipt) return;
    await Share.share({
      message: [
        'Meridian Receipt',
        `Job: ${intentId}`,
        `Amount: $${receipt.amount} ${receipt.currency}`,
        `Status: ${receipt.status}`,
        receipt.verifiedAt ? `Verified: ${new Date(receipt.verifiedAt).toLocaleString()}` : '',
        `Signature: ${receipt.signature.slice(0, 24)}…`,
        '',
        'Powered by AgentPay · agentpay.so',
      ].filter(Boolean).join('\n'),
    });
  };

  const handleDone = () => {
    reset();
    router.replace('/(main)/converse');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color="#4b5563" />
        </Pressable>

        {loading && <ActivityIndicator color="#6366f1" style={{ marginTop: 80 }} />}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {receipt && !loading && (
          <>
            {/* Success badge */}
            <View style={styles.badge}>
              <LinearGradient colors={['#052e16', '#14532d']} style={styles.badgeGrad}>
                <Ionicons name="checkmark" size={36} color="#4ade80" />
              </LinearGradient>
            </View>

            <Text style={styles.amount}>${receipt.amount} {receipt.currency}</Text>
            <Text style={styles.subtitle}>
              {currentAgent ? `via ${currentAgent.name}` : 'Payment verified'}
            </Text>

            {/* Receipt card */}
            <View style={styles.card}>
              <Row label="Status"   value={receipt.status}  pill />
              {receipt.agentId   && <Row label="Agent"    value={shortId(receipt.agentId)} mono />}
              {receipt.merchantId && <Row label="Merchant" value={shortId(receipt.merchantId)} mono />}
              {receipt.verifiedAt && (
                <Row label="Verified" value={new Date(receipt.verifiedAt).toLocaleString()} />
              )}
              <Row label="Intent ID" value={shortId(receipt.intentId)} mono />
            </View>

            {/* Signature */}
            <View style={styles.sigCard}>
              <View style={styles.sigHeader}>
                <Ionicons name="shield-checkmark" size={13} color="#22c55e" />
                <Text style={styles.sigLabel}>HMAC-SHA256 · AgentPay Network</Text>
              </View>
              <Text style={styles.sigValue} numberOfLines={2}>
                {receipt.signature}
              </Text>
            </View>

            {/* Actions */}
            <Pressable onPress={handleShare} style={styles.shareBtn}>
              <Ionicons name="share-outline" size={18} color="#818cf8" />
              <Text style={styles.shareBtnText}>Share Receipt</Text>
            </Pressable>

            <Pressable onPress={handleDone} style={styles.doneBtn}>
              <Text style={styles.doneBtnText}>New Request</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function shortId(id: string) {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function Row({
  label, value, mono, pill,
}: {
  label: string; value: string; mono?: boolean; pill?: boolean;
}) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      {pill ? (
        <View style={rowStyles.pill}>
          <Text style={rowStyles.pillText}>{value}</Text>
        </View>
      ) : (
        <Text style={[rowStyles.value, mono && rowStyles.mono]} numberOfLines={1}>
          {value}
        </Text>
      )}
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  label:     { fontSize: 13, color: '#6b7280' },
  value:     { fontSize: 13, color: '#d1d5db', maxWidth: '55%', textAlign: 'right' },
  mono:      { fontFamily: 'monospace', fontSize: 11 },
  pill:      { backgroundColor: '#052e16', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  pillText:  { fontSize: 12, color: '#4ade80', fontWeight: '600' },
});

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#080808' },
  container: { padding: 24, alignItems: 'center', paddingBottom: 60 },
  back:      { alignSelf: 'flex-start', marginBottom: 32 },

  badge: {
    marginBottom: 20,
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 10,
  },
  badgeGrad: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  amount:   { fontSize: 36, fontWeight: '800', color: '#f9fafb', letterSpacing: -1, marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#6b7280', marginBottom: 32 },

  card: {
    width: '100%',
    backgroundColor: '#0d0d0d',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    marginBottom: 12,
  },

  sigCard: {
    width: '100%',
    backgroundColor: '#050f07',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#14532d',
    marginBottom: 28,
  },
  sigHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  sigLabel: {
    fontSize: 11,
    color: '#22c55e',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sigValue: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#4ade80',
    lineHeight: 16,
  },

  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#1e1b4b',
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 14,
    marginBottom: 10,
    width: '100%',
    justifyContent: 'center',
  },
  shareBtnText: { fontSize: 15, fontWeight: '600', color: '#818cf8' },

  doneBtn: { width: '100%', alignItems: 'center', paddingVertical: 14 },
  doneBtnText: { fontSize: 14, color: '#4b5563' },

  errorBox: { marginTop: 60, padding: 20 },
  errorText: { fontSize: 14, color: '#f87171', textAlign: 'center', lineHeight: 21 },
});
