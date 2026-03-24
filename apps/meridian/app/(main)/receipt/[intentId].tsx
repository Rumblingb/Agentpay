/**
 * Receipt screen — signed settlement proof + boarding QR
 *
 * - Shows journey details + HMAC-verified payment proof
 * - "Show Ticket" → full-screen QR mode for station staff
 * - Caches QR image locally via expo-file-system (works offline)
 * - Saves trip to AsyncStorage for My Trips history
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
  Modal,
  Image,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import { getReceipt, type Receipt } from '../../../lib/api';
import { useStore } from '../../../lib/store';
import { saveActiveTrip, upsertTrip } from '../../../lib/storage';

const { width: SCREEN_W } = Dimensions.get('window');
const QR_SIZE = Math.min(SCREEN_W - 80, 280);

function qrUrl(ref: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(ref)}&format=png&margin=2`;
}

export default function ReceiptScreen() {
  const params = useLocalSearchParams<{
    intentId: string;
    bookingRef?: string;
    departureTime?: string;
    platform?: string;
    operator?: string;
    fromStation?: string;
    toStation?: string;
    fiatAmount?: string;
    currencySymbol?: string;
    currencyCode?: string;
  }>();
  const {
    intentId, bookingRef, departureTime, platform, operator, fromStation, toStation,
    fiatAmount: fiatAmountParam, currencySymbol: symParam, currencyCode: codeParam,
  } = params;

  // Fiat display: prefer URL params (passed from booking flow), fall back to receipt.amount
  const fiatSymbol   = symParam  ?? '£';
  const fiatCode     = codeParam ?? 'GBP';
  const fiatAmountNum = fiatAmountParam ? parseFloat(fiatAmountParam) : null;
  const { reset, currentAgent } = useStore();
  const [receipt,     setReceipt]     = useState<Receipt | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [showTicket,  setShowTicket]  = useState(false);
  const [qrLocalUri,  setQrLocalUri]  = useState<string | null>(null);
  const [qrLoading,   setQrLoading]   = useState(false);

  const hasJourneyDetails = !!(bookingRef || departureTime || fromStation);

  // ── Fetch receipt ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!intentId) return;
    getReceipt(intentId)
      .then(setReceipt)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [intentId]);

  // ── Cache QR image locally for offline use ───────────────────────────────
  useEffect(() => {
    if (!bookingRef) return;
    const localPath = `${FileSystem.cacheDirectory}qr_${bookingRef.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
    setQrLoading(true);
    FileSystem.getInfoAsync(localPath)
      .then(info => {
        if (info.exists) {
          setQrLocalUri(localPath);
          setQrLoading(false);
        } else {
          return FileSystem.downloadAsync(qrUrl(bookingRef), localPath)
            .then(() => { setQrLocalUri(localPath); })
            .catch(() => { setQrLocalUri(qrUrl(bookingRef)); });
        }
      })
      .catch(() => { setQrLocalUri(qrUrl(bookingRef)); })
      .finally(() => setQrLoading(false));
  }, [bookingRef]);

  // ── Save trip to My Trips history ────────────────────────────────────────
  useEffect(() => {
    if (!receipt || !intentId) return;
    const entry = {
      intentId,
      bookingRef:    bookingRef    ?? null,
      fromStation:   fromStation   ?? null,
      toStation:     toStation     ?? null,
      departureTime: departureTime ?? null,
      platform:      platform      ?? null,
      operator:      operator      ?? null,
      amount:        receipt.amount,
      currency:      receipt.currency,
      fiatAmount:    fiatAmountNum,
      currencySymbol: fiatSymbol,
      currencyCode:  fiatCode,
      savedAt:       new Date().toISOString(),
    };
    void upsertTrip(entry);
    void saveActiveTrip({
      intentId,
      status: 'ticketed',
      title: fromStation && toStation ? `${fromStation} → ${toStation}` : 'Train journey',
      fromStation: fromStation ?? null,
      toStation: toStation ?? null,
      departureTime: departureTime ?? null,
      platform: platform ?? null,
      operator: operator ?? null,
      bookingRef: bookingRef ?? null,
      fiatAmount: fiatAmountNum,
      currencySymbol: fiatSymbol,
      currencyCode: fiatCode,
      updatedAt: new Date().toISOString(),
    });
  }, [receipt, intentId, bookingRef, fromStation, toStation, departureTime, platform, operator, fiatAmountNum, fiatSymbol, fiatCode]);

  const handleShare = async () => {
    if (!receipt) return;
    await Share.share({
      message: [
        'Bro — Booking Confirmed',
        bookingRef    ? `Reference: ${bookingRef}` : null,
        fromStation && toStation ? `${fromStation} → ${toStation}` : null,
        departureTime ? `Departs: ${departureTime}` : null,
        platform      ? `Platform: ${platform}`     : null,
        fiatAmountNum != null
          ? `Amount: ${fiatSymbol}${fiatCode === 'INR' ? Math.round(fiatAmountNum).toLocaleString('en-IN') : fiatAmountNum.toFixed(2)}`
          : null,
        '',
        'agentpay.gg',
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

            <Text style={styles.amount}>
              {fiatAmountNum != null
                ? `${fiatSymbol}${fiatCode === 'INR' ? Math.round(fiatAmountNum).toLocaleString('en-IN') : fiatAmountNum.toFixed(2)}`
                : `${fiatSymbol}${receipt.amount}`}
            </Text>
            <Text style={styles.subtitle}>
              {fromStation && toStation ? `${fromStation} → ${toStation}` : 'Booking confirmed'}
            </Text>

            {/* Receipt card */}
            <View style={styles.card}>
              <Row label="Status" value="Confirmed" pill />
              {receipt.verifiedAt && (
                <Row label="Processed" value={new Date(receipt.verifiedAt).toLocaleString()} />
              )}
            </View>

            {/* Journey Details + QR */}
            {hasJourneyDetails && (
              <View style={styles.journeyCard}>
                <View style={styles.journeyHeader}>
                  <Text style={styles.journeyIcon}>🚂</Text>
                  <Text style={styles.journeyTitle}>Journey Details</Text>
                </View>

                {bookingRef && (
                  <View style={styles.journeyRefWrap}>
                    <Text style={styles.journeyRefLabel}>Booking Reference</Text>
                    <Text style={styles.journeyRef}>{bookingRef}</Text>
                  </View>
                )}

                {fromStation && toStation && (
                  <Row label="Route" value={`${fromStation} → ${toStation}`} />
                )}
                {departureTime && <Row label="Departs"  value={departureTime} />}
                {platform      && <Row label="Platform" value={platform} />}
                {operator      && <Row label="Operator" value={operator} />}

                {/* Show Ticket button — full-screen QR */}
                {bookingRef && (
                  <Pressable
                    onPress={() => setShowTicket(true)}
                    style={styles.showTicketBtn}
                  >
                    {qrLoading ? (
                      <ActivityIndicator color="#4ade80" size="small" />
                    ) : (
                      <Ionicons name="qr-code-outline" size={18} color="#4ade80" />
                    )}
                    <Text style={styles.showTicketText}>Show Ticket QR</Text>
                  </Pressable>
                )}
              </View>
            )}

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

      {/* ── Full-screen ticket QR modal ─────────────────────────────────── */}
      <Modal
        visible={showTicket}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowTicket(false)}
      >
        <View style={ticketStyles.container}>
          <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>

            <Text style={ticketStyles.label}>SHOW THIS TO STAFF</Text>

            {/* QR code */}
            {qrLocalUri ? (
              <View style={ticketStyles.qrWrap}>
                <Image
                  source={{ uri: qrLocalUri }}
                  style={{ width: QR_SIZE, height: QR_SIZE }}
                  resizeMode="contain"
                />
              </View>
            ) : (
              <View style={[ticketStyles.qrWrap, { alignItems: 'center', justifyContent: 'center' }]}>
                <ActivityIndicator color="#111" size="large" />
              </View>
            )}

            {/* Booking ref */}
            {bookingRef && (
              <Text style={ticketStyles.ref}>{bookingRef}</Text>
            )}

            {/* Route */}
            {fromStation && toStation && (
              <Text style={ticketStyles.route}>{fromStation} → {toStation}</Text>
            )}
            {departureTime && (
              <Text style={ticketStyles.time}>Departs {departureTime}</Text>
            )}
            {platform && (
              <Text style={ticketStyles.platform}>Platform {platform}</Text>
            )}

            <Pressable onPress={() => setShowTicket(false)} style={ticketStyles.closeBtn} hitSlop={16}>
              <Text style={ticketStyles.closeText}>Back to Receipt</Text>
            </Pressable>

          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

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

// ── Styles ────────────────────────────────────────────────────────────────────

const rowStyles = StyleSheet.create({
  row:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  label:    { fontSize: 13, color: '#6b7280' },
  value:    { fontSize: 13, color: '#d1d5db', maxWidth: '55%', textAlign: 'right' },
  mono:     { fontFamily: 'monospace', fontSize: 11 },
  pill:     { backgroundColor: '#052e16', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  pillText: { fontSize: 12, color: '#4ade80', fontWeight: '600' },
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

  journeyCard: {
    width: '100%',
    backgroundColor: '#0a1a0a',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#14532d',
    marginBottom: 12,
  },
  journeyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  journeyIcon:  { fontSize: 18 },
  journeyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4ade80',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  journeyRefWrap: {
    alignItems: 'center',
    backgroundColor: '#052e16',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  journeyRefLabel: {
    fontSize: 10,
    color: '#4b5563',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  journeyRef: {
    fontSize: 22,
    fontWeight: '700',
    color: '#4ade80',
    letterSpacing: 2.5,
    fontFamily: 'monospace',
  },

  showTicketBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    backgroundColor: '#052e16',
    borderRadius: 12,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: '#14532d',
  },
  showTicketText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4ade80',
    letterSpacing: 0.3,
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

  doneBtn:     { width: '100%', alignItems: 'center', paddingVertical: 14 },
  doneBtnText: { fontSize: 14, color: '#4b5563' },

  errorBox:  { marginTop: 60, padding: 20 },
  errorText: { fontSize: 14, color: '#f87171', textAlign: 'center', lineHeight: 21 },
});

// ── Full-screen ticket styles ─────────────────────────────────────────────────

const ticketStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6b7280',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 24,
  },
  qrWrap: {
    width: QR_SIZE + 24,
    height: QR_SIZE + 24,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: 24,
  },
  ref: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111',
    letterSpacing: 3,
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  route: {
    fontSize: 16,
    color: '#374151',
    fontWeight: '600',
    marginBottom: 4,
  },
  time: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 4,
  },
  platform: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 32,
  },
  closeBtn: {
    marginTop: 24,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  closeText: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '600',
  },
});
