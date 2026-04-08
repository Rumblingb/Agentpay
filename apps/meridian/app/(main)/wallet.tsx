/**
 * Wallet screen — USDC balance, deposit instructions, and saved payment cards
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Share,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getWallet, getPaymentMethods, deletePaymentMethod, type PaymentMethod } from '../../lib/api';
import { useStore } from '../../lib/store';

/** Convert USDC (≈ USD) to local fiat for display */
function usdcToFiat(usdc: number, currencyCode: string, currencySymbol: string): string {
  const rates: Record<string, number> = {
    USD: 1, GBP: 0.79, EUR: 0.93, INR: 84, AUD: 1.54,
    CAD: 1.36, SGD: 1.35, AED: 3.67,
  };
  const fiat = usdc * (rates[currencyCode] ?? 1);
  if (currencyCode === 'INR') {
    return `${currencySymbol}${Math.round(fiat).toLocaleString('en-IN')}`;
  }
  return `${currencySymbol}${fiat.toFixed(2)}`;
}


export default function WalletScreen() {
  const { agentId, wallet, setWallet, paymentMethods, setPaymentMethods, currencySymbol, currencyCode } = useStore();
  const [loading, setLoading] = useState(true);
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [depositMemo, setDepositMemo] = useState<string | null>(null);
  const [cardLoading, setCardLoading] = useState(false);

  const loadAll = useCallback(() => {
    if (!agentId) return;
    setLoading(true);
    Promise.all([
      getWallet(agentId).then((res) => {
        setWallet(res.wallet);
        setDepositAddress((res as any).depositAddress ?? null);
        setDepositMemo((res as any).depositMemo ?? null);
      }),
      getPaymentMethods(agentId).then((res) => setPaymentMethods(res.methods)).catch(() => {}),
    ])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [agentId, setWallet, setPaymentMethods]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleShareDeposit = async () => {
    if (!depositAddress) return;
    await Share.share({
      message: `AgentPay top-up address: ${depositAddress}\nMemo (required): ${depositMemo}`,
    });
  };

  const handleCopyAddress = async () => {
    if (!depositAddress) return;
    await Share.share({ message: depositAddress });
  };

  const handleRemoveCard = (method: PaymentMethod) => {
    Alert.alert(
      'Remove card',
      `Remove •••• ${method.last4 ?? ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setCardLoading(true);
            try {
              await deletePaymentMethod(method.id);
              setPaymentMethods(paymentMethods.filter((m) => m.id !== method.id));
            } catch {
              Alert.alert('Error', 'Could not remove card. Try again.');
            } finally {
              setCardLoading(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#6b7280" />
          </Pressable>
          <Text style={styles.headerTitle}>Wallet</Text>
          <Pressable onPress={loadAll} hitSlop={12}>
            <Ionicons name="refresh-outline" size={18} color="#6b7280" />
          </Pressable>
        </View>

        {loading && <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />}

        {!loading && wallet && (
          <>
            {/* Balance card */}
            <LinearGradient colors={['#1e1b4b', '#312e81']} style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>Available Balance</Text>
              <Text style={styles.balanceAmount}>
                {usdcToFiat(wallet.availableUsdc, currencyCode, currencySymbol)}
              </Text>
              {wallet.reservedUsdc > 0 && (
                <Text style={styles.reserved}>
                  {usdcToFiat(wallet.reservedUsdc, currencyCode, currencySymbol)} reserved
                </Text>
              )}
            </LinearGradient>

            {/* Saved payment cards */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Ionicons name="card-outline" size={16} color="#6b7280" />
                <Text style={styles.sectionTitle}>Payment Cards</Text>
              </View>

              {paymentMethods.length === 0 && (
                <Text style={styles.emptyNote}>
                  No cards saved. Add a card so Ace can complete bookings without interrupting you.
                </Text>
              )}

              {paymentMethods.map((method) => (
                <View key={method.id} style={styles.cardRow}>
                  <Ionicons name="card-outline" size={20} color="#6366f1" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardLabel}>
                      {method.brand ? method.brand.charAt(0).toUpperCase() + method.brand.slice(1) : 'Card'}{' '}
                      •••• {method.last4 ?? '——'}
                    </Text>
                    {method.isDefault && (
                      <Text style={styles.defaultBadge}>Default</Text>
                    )}
                  </View>
                  <Pressable onPress={() => handleRemoveCard(method)} hitSlop={10} disabled={cardLoading}>
                    <Ionicons name="trash-outline" size={16} color="#4b5563" />
                  </Pressable>
                </View>
              ))}

              {/* Add card — opens Setup Intent flow once @stripe/stripe-react-native is installed */}
              <Pressable style={styles.addCardBtn} onPress={() => Alert.alert('Add Card', 'Complete Stripe setup to enable native card entry.\nInstall @stripe/stripe-react-native and wire createSetupIntent() from lib/api.ts.')}>
                <Ionicons name="add-circle-outline" size={16} color="#6366f1" />
                <Text style={styles.addCardText}>Add payment card</Text>
              </Pressable>
            </View>

            {/* Top-up instructions */}
            {depositAddress && (
              <View style={styles.depositCard}>
                <View style={styles.depositHeader}>
                  <Ionicons name="arrow-down-circle" size={18} color="#6366f1" />
                  <Text style={styles.depositTitle}>Add Funds (USDC)</Text>
                </View>
                <Text style={styles.depositNote}>
                  Top up your Ace balance so booking can move without payment friction.
                </Text>

                <View style={styles.depositField}>
                  <Text style={styles.fieldLabel}>Address</Text>
                  <Text style={styles.fieldValue} numberOfLines={1}>{depositAddress}</Text>
                </View>
                <View style={styles.depositField}>
                  <Text style={styles.fieldLabel}>Memo (required)</Text>
                  <Text style={styles.fieldValue}>{depositMemo}</Text>
                </View>

                <View style={styles.depositActions}>
                  <Pressable onPress={handleShareDeposit} style={styles.shareBtn}>
                    <Ionicons name="share-outline" size={15} color="#6366f1" />
                    <Text style={styles.shareBtnText}>Share top-up details</Text>
                  </Pressable>
                  <Pressable onPress={handleCopyAddress} style={styles.copyBtn}>
                    <Ionicons name="copy-outline" size={15} color="#6b7280" />
                    <Text style={styles.copyBtnText}>Copy address</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Spending policy CTA */}
            <Pressable style={styles.policyCard}>
              <Ionicons name="shield-outline" size={18} color="#6b7280" />
              <View style={{ flex: 1 }}>
                <Text style={styles.policyTitle}>Spending Policy</Text>
                <Text style={styles.policyNote}>Set daily/monthly limits, allowed agents, and more.</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#374151" />
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: '#080808' },
  container:     { padding: 20, paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  headerTitle:   { fontSize: 18, fontWeight: '600', color: '#f9fafb' },
  balanceCard:   { borderRadius: 18, padding: 24, marginBottom: 16 },
  balanceLabel:  { fontSize: 13, color: '#a5b4fc', marginBottom: 8 },
  balanceAmount: { fontSize: 38, fontWeight: '700', color: '#fff' },
  reserved:      { fontSize: 12, color: '#818cf8', marginTop: 4 },
  sectionCard: {
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    marginBottom: 12,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle:  { fontSize: 15, fontWeight: '600', color: '#f9fafb' },
  emptyNote:     { fontSize: 13, color: '#4b5563', lineHeight: 18, marginBottom: 12 },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  cardLabel:    { fontSize: 14, color: '#d1d5db', fontWeight: '500' },
  defaultBadge: { fontSize: 11, color: '#6366f1', marginTop: 2 },
  addCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  addCardText:    { fontSize: 14, color: '#6366f1' },
  depositCard: {
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    marginBottom: 12,
  },
  depositHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  depositTitle:   { fontSize: 15, fontWeight: '600', color: '#f9fafb' },
  depositNote:    { fontSize: 13, color: '#6b7280', lineHeight: 18, marginBottom: 14 },
  depositField: {
    backgroundColor: '#0d0d0d',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  fieldLabel:  { fontSize: 11, color: '#4b5563', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.4 },
  fieldValue:  { fontSize: 13, color: '#d1d5db', fontFamily: 'monospace' },
  depositActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 6 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  shareBtnText: { fontSize: 14, color: '#6366f1' },
  copyBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  copyBtnText: { fontSize: 14, color: '#6b7280' },
  policyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  policyTitle: { fontSize: 14, fontWeight: '500', color: '#d1d5db', marginBottom: 2 },
  policyNote:  { fontSize: 12, color: '#4b5563' },
});
