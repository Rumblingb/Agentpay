/**
 * Receipt screen — signed settlement proof
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
import { Ionicons } from '@expo/vector-icons';
import { getReceipt, type Receipt } from '../../../lib/api';
import { useStore } from '../../../lib/store';

export default function ReceiptScreen() {
  const { intentId } = useLocalSearchParams<{ intentId: string }>();
  const { reset } = useStore();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      message: `AgentPay Receipt\nJob: ${intentId}\nAmount: $${receipt.amount} ${receipt.currency}\nVerified: ${receipt.verifiedAt ?? 'pending'}\nSignature: ${receipt.signature.slice(0, 20)}…`,
    });
  };

  const handleDone = () => {
    reset();
    router.replace('/(main)/converse');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Back */}
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Ionicons name="arrow-back" size={20} color="#6b7280" />
        </Pressable>

        {loading && <ActivityIndicator color="#6366f1" style={{ marginTop: 60 }} />}

        {error && (
          <Text style={styles.error}>{error}</Text>
        )}

        {receipt && !loading && (
          <>
            {/* Success header */}
            <View style={styles.successIcon}>
              <Ionicons name="checkmark-circle" size={60} color="#22c55e" />
            </View>
            <Text style={styles.title}>Receipt</Text>
            <Text style={styles.subtitle}>Payment verified on AgentPay network</Text>

            {/* Receipt card */}
            <View style={styles.card}>
              <Row label="Intent ID"  value={receipt.intentId} mono />
              <Row label="Status"     value={receipt.status} />
              <Row label="Amount"     value={`$${receipt.amount} ${receipt.currency}`} highlight />
              {receipt.agentId   && <Row label="Agent"    value={receipt.agentId} mono />}
              {receipt.merchantId && <Row label="Merchant" value={receipt.merchantId} mono />}
              {receipt.verifiedAt && <Row label="Verified" value={new Date(receipt.verifiedAt).toLocaleString()} />}
            </View>

            {/* Signature */}
            <View style={styles.sigCard}>
              <View style={styles.sigHeader}>
                <Ionicons name="shield-checkmark" size={14} color="#22c55e" />
                <Text style={styles.sigLabel}>HMAC-SHA256 Signature</Text>
              </View>
              <Text style={styles.sigValue} numberOfLines={3}>
                {receipt.signature}
              </Text>
            </View>

            {/* Actions */}
            <Pressable onPress={handleShare} style={styles.shareBtn}>
              <Ionicons name="share-outline" size={18} color="#6366f1" />
              <Text style={styles.shareBtnText}>Share Receipt</Text>
            </Pressable>

            <Pressable onPress={handleDone} style={styles.doneBtn}>
              <Text style={styles.doneBtnText}>Start New Request</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label, value, mono, highlight,
}: {
  label: string; value: string; mono?: boolean; highlight?: boolean;
}) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      <Text
        style={[rowStyles.value, mono && rowStyles.mono, highlight && rowStyles.highlight]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  label:     { fontSize: 13, color: '#6b7280' },
  value:     { fontSize: 13, color: '#d1d5db', maxWidth: '60%', textAlign: 'right' },
  mono:      { fontFamily: 'monospace', fontSize: 11 },
  highlight: { color: '#22c55e', fontWeight: '700', fontSize: 15 },
});

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: '#080808' },
  container:  { padding: 24, alignItems: 'center' },
  back:       { alignSelf: 'flex-start', marginBottom: 24 },
  successIcon:{ marginBottom: 16 },
  title:      { fontSize: 26, fontWeight: '700', color: '#f9fafb', marginBottom: 6 },
  subtitle:   { fontSize: 14, color: '#6b7280', marginBottom: 28, textAlign: 'center' },
  card: {
    width: '100%',
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    marginBottom: 12,
  },
  sigCard: {
    width: '100%',
    backgroundColor: '#0d1a0f',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#14532d',
    marginBottom: 28,
  },
  sigHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  sigLabel:  { fontSize: 11, color: '#22c55e', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  sigValue:  { fontSize: 11, fontFamily: 'monospace', color: '#4ade80', lineHeight: 18 },
  error:     { color: '#ef4444', fontSize: 14, marginTop: 40 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#3730a3',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 13,
    marginBottom: 12,
    width: '100%',
    justifyContent: 'center',
  },
  shareBtnText: { fontSize: 15, fontWeight: '600', color: '#818cf8' },
  doneBtn: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 13,
  },
  doneBtnText: { fontSize: 14, color: '#6b7280' },
});
