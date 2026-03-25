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
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import { getReceipt, type Receipt, reportIssue, registerJobWatch } from '../../../lib/api';
import { useStore } from '../../../lib/store';
import { loadActiveTrip, saveActiveTrip, upsertTrip } from '../../../lib/storage';
import { scheduleJourneyNotifications, requestNotificationPermission, getExpoPushToken } from '../../../lib/notifications';
import { fetchWeatherForStation, type WeatherData } from '../../../lib/weather';

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
    departureDatetime?: string;
    platform?: string;
    operator?: string;
    finalLegSummary?: string;
    fromStation?: string;
    toStation?: string;
    fiatAmount?: string;
    currencySymbol?: string;
    currencyCode?: string;
    cancelled?: string;
  }>();
  const {
    intentId, bookingRef, departureTime, departureDatetime, platform, operator,
    fromStation, toStation,
    finalLegSummary,
    fiatAmount: fiatAmountParam, currencySymbol: symParam, currencyCode: codeParam,
    cancelled,
  } = params;

  const isCancelled = cancelled === 'true';

  // Fiat display: prefer URL params (passed from booking flow), fall back to receipt.amount
  const fiatSymbol   = symParam  ?? '£';
  const fiatCode     = codeParam ?? 'GBP';
  const fiatAmountNum = fiatAmountParam ? parseFloat(fiatAmountParam) : null;
  const { reset, currentAgent, agentId } = useStore();
  const [receipt,     setReceipt]     = useState<Receipt | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [showTicket,  setShowTicket]  = useState(false);
  const [qrLocalUri,  setQrLocalUri]  = useState<string | null>(null);
  const [qrLoading,   setQrLoading]   = useState(false);
  const [preservedFinalLegSummary, setPreservedFinalLegSummary] = useState<string | null>(finalLegSummary ?? null);
  const [showIssue,    setShowIssue]    = useState(false);
  const [issueText,    setIssueText]    = useState('');
  const [issueSending, setIssueSending] = useState(false);
  const [issueSent,    setIssueSent]    = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);

  const hasJourneyDetails = !!(bookingRef || departureTime || fromStation);

  // ── Fetch receipt ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!intentId) return;
    getReceipt(intentId)
      .then(setReceipt)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [intentId]);

  useEffect(() => {
    if (finalLegSummary) {
      setPreservedFinalLegSummary(finalLegSummary);
      return;
    }
    void loadActiveTrip().then((trip) => {
      if (trip?.intentId === intentId && trip.finalLegSummary) {
        setPreservedFinalLegSummary(trip.finalLegSummary);
      }
    });
  }, [finalLegSummary, intentId]);

  useEffect(() => {
    let active = true;

    if (!fromStation) {
      setWeather(null);
      return () => {
        active = false;
      };
    }

    fetchWeatherForStation(fromStation)
      .then((result) => {
        if (active) setWeather(result);
      })
      .catch(() => {
        if (active) setWeather(null);
      });

    return () => {
      active = false;
    };
  }, [fromStation]);

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
      finalLegSummary: preservedFinalLegSummary,
      fiatAmount: fiatAmountNum,
      currencySymbol: fiatSymbol,
      currencyCode: fiatCode,
      updatedAt: new Date().toISOString(),
    });
  }, [receipt, intentId, bookingRef, fromStation, toStation, departureTime, platform, operator, preservedFinalLegSummary, fiatAmountNum, fiatSymbol, fiatCode]);

  // ── Schedule departure notifications ─────────────────────────────────────
  // Prefer departureDatetime (ISO, precise) over departureTime (HH:MM, heuristic)
  useEffect(() => {
    const depStr = departureDatetime ?? departureTime;
    if (!intentId || !depStr) return;
    const route = fromStation && toStation ? `${fromStation} → ${toStation}` : 'Your journey';
    void (async () => {
      const granted = await requestNotificationPermission();
      if (!granted) return;
      await scheduleJourneyNotifications(intentId, depStr, route, platform ?? null);
      // Register for platform change push notifications
      const token = await getExpoPushToken();
      if (token) await registerJobWatch(intentId, token);
    })();
  }, [intentId, departureTime, fromStation, toStation, platform]);

  const handleShare = async () => {
    await Share.share({
      message: [
        receipt ? 'Bro — Booking Confirmed' : 'Bro — Journey details',
        bookingRef    ? `Reference: ${bookingRef}` : null,
        fromStation && toStation ? `${fromStation} → ${toStation}` : null,
        departureTime ? `Departs: ${departureTime}` : null,
        platform      ? `Platform: ${platform}`     : null,
        preservedFinalLegSummary ? `Next: ${preservedFinalLegSummary}` : null,
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

  const handleReportIssue = async () => {
    if (!issueText.trim() || issueSending) return;
    setIssueSending(true);
    try {
      await reportIssue({
        intentId: intentId ?? '',
        bookingRef: bookingRef ?? null,
        description: issueText.trim(),
        hirerId: agentId ?? '',
      });
      setIssueSent(true);
      setIssueText('');
    } catch {
      // silently fail — issue logged on retry
    } finally {
      setIssueSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color="#4b5563" />
        </Pressable>

        {loading && <ActivityIndicator color="#6366f1" style={{ marginTop: 80 }} />}

        {error && !hasJourneyDetails && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Cancellation banner — shown when notification tap carries action=cancelled */}
        {isCancelled && (
          <View style={styles.cancelBanner}>
            <Ionicons name="warning" size={18} color="#fbbf24" />
            <View style={{ flex: 1 }}>
              <Text style={styles.cancelBannerTitle}>Train cancelled</Text>
              <Text style={styles.cancelBannerBody}>Ask Bro for the next available service on this route.</Text>
            </View>
            <Pressable
              style={styles.cancelBannerBtn}
              onPress={() => {
                const query = fromStation && toStation ? `${fromStation} to ${toStation} next available` : undefined;
                router.replace({ pathname: '/(main)/converse', params: query ? { prefill: query } : undefined } as any);
              }}
            >
              <Text style={styles.cancelBannerBtnText}>Ask Bro</Text>
            </Pressable>
          </View>
        )}

        {((receipt && !loading) || (!loading && hasJourneyDetails)) && (
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
                : receipt
                ? `${fiatSymbol}${receipt.amount}`
                : 'Journey ready'}
            </Text>
            <Text style={styles.subtitle}>
              {fromStation && toStation
                ? `${fromStation} → ${toStation}`
                : receipt
                ? 'Booking confirmed'
                : 'Saved on this device'}
            </Text>

            {/* Receipt card */}
            <View style={styles.card}>
              <Row label="Status" value={receipt ? 'Confirmed' : 'Saved locally'} pill />
              {receipt?.verifiedAt && (
                <Row label="Processed" value={new Date(receipt.verifiedAt).toLocaleString()} />
              )}
              {error && (
                <Text style={styles.localNotice}>
                  Live receipt lookup is unavailable right now. Bro is showing the journey details saved on this device.
                </Text>
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
                {departureTime && (
                  <View style={rowStyles.row}>
                    <Text style={rowStyles.label}>Departs</Text>
                    <View style={styles.departureMeta}>
                      <Text style={rowStyles.value}>{departureTime}</Text>
                      {weather && (
                        <View style={styles.weatherPill}>
                          <Text style={styles.weatherPillText}>
                            {`${Math.round(weather.tempC)}°C · ${weather.description}`}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}
                {platform      && <Row label="Platform" value={platform} />}
                {operator      && <Row label="Operator" value={operator} />}
                {preservedFinalLegSummary && <Row label="Next step" value={preservedFinalLegSummary} />}

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

            <Pressable onPress={() => setShowIssue(true)} style={styles.issueBtn}>
              <Ionicons name="alert-circle-outline" size={15} color="#6b7280" />
              <Text style={styles.issueBtnText}>Problem with this booking?</Text>
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

      {/* ── Issue report modal ──────────────────────────────────────── */}
      <Modal
        visible={showIssue}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowIssue(false)}
      >
        <View style={issueStyles.container}>
          <View style={issueStyles.handle} />
          <Text style={issueStyles.title}>Report an issue</Text>
          <Text style={issueStyles.subtitle}>
            Describe the problem and Bro will look into it.
          </Text>
          {issueSent ? (
            <View style={issueStyles.sentBox}>
              <Ionicons name="checkmark-circle" size={32} color="#4ade80" />
              <Text style={issueStyles.sentText}>Got it — we'll look into this.</Text>
              <Pressable onPress={() => { setShowIssue(false); setIssueSent(false); }} style={issueStyles.closeBtn}>
                <Text style={issueStyles.closeBtnText}>Close</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                style={issueStyles.input}
                placeholder="e.g. Wrong platform, booking not confirmed…"
                placeholderTextColor="#4b5563"
                multiline
                numberOfLines={4}
                value={issueText}
                onChangeText={setIssueText}
                autoFocus
              />
              <Pressable
                onPress={handleReportIssue}
                style={[issueStyles.submitBtn, (!issueText.trim() || issueSending) && issueStyles.submitBtnDisabled]}
                disabled={!issueText.trim() || issueSending}
              >
                {issueSending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={issueStyles.submitBtnText}>Send report</Text>
                }
              </Pressable>
              <Pressable onPress={() => setShowIssue(false)} style={issueStyles.cancelBtn}>
                <Text style={issueStyles.cancelBtnText}>Cancel</Text>
              </Pressable>
            </>
          )}
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

  cancelBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#451a03',
    borderWidth: 1,
    borderColor: '#92400e',
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 24,
    marginTop: 16,
    marginBottom: 8,
  },
  cancelBannerTitle: { fontSize: 14, fontWeight: '700', color: '#fbbf24', marginBottom: 2 },
  cancelBannerBody:  { fontSize: 12, color: '#d97706', lineHeight: 17 },
  cancelBannerBtn: {
    backgroundColor: '#78350f',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cancelBannerBtnText: { fontSize: 13, fontWeight: '700', color: '#fbbf24' },

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
  localNotice: {
    marginTop: 4,
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
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
  departureMeta: {
    alignItems: 'flex-end',
    gap: 6,
    maxWidth: '60%',
  },
  weatherPill: {
    backgroundColor: '#0b1320',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  weatherPillText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
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

  issueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginBottom: 4,
  },
  issueBtnText: {
    fontSize: 13,
    color: '#6b7280',
  },

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

const issueStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
    padding: 24,
    paddingTop: 16,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#2d2d2d',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f9fafb',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
    marginBottom: 24,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#f9fafb',
    borderWidth: 1,
    borderColor: '#262626',
    minHeight: 120,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  submitBtn: {
    backgroundColor: '#4f46e5',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  cancelBtnText: {
    fontSize: 14,
    color: '#4b5563',
  },
  sentBox: {
    alignItems: 'center',
    paddingTop: 40,
    gap: 16,
  },
  sentText: {
    fontSize: 16,
    color: '#d1d5db',
    textAlign: 'center',
  },
  closeBtn: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  closeBtnText: {
    fontSize: 15,
    color: '#9ca3af',
    fontWeight: '600',
  },
});
