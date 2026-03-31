import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getIntentStatus } from '../../../lib/api';
import { journeyDisplayRoute, journeyIsLive, journeyPrimaryIntentPrompt, journeyProactiveActionLabel, journeyStatusLabel } from '../../../lib/journeySession';
import { loadJourneySession, patchJourneySession, saveJourneySession, type JourneySession } from '../../../lib/storage';
import { parseTripContext, paymentConfirmedFromMetadata, syncTripBookingState, tripCards } from '../../../lib/trip';
import { C } from '../../../lib/theme';

function sessionTone(session: JourneySession) {
  switch (session.state) {
    case 'attention':
      return { border: '#92400e', bg: '#1c1917', text: '#fbbf24' };
    case 'payment_pending':
      return { border: '#1d4ed8', bg: '#0f172a', text: '#93c5fd' };
    case 'ticketed':
    case 'in_transit':
    case 'arriving':
      return { border: '#166534', bg: '#052e16', text: '#86efac' };
    default:
      return { border: '#334155', bg: '#0b1220', text: '#cbd5e1' };
  }
}

function statusLookupId(session: JourneySession): string {
  return session.jobId || session.intentId || '';
}

export default function JourneyScreen() {
  const { intentId } = useLocalSearchParams<{ intentId: string }>();
  const [session, setSession] = useState<JourneySession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    if (!intentId) return;
    setLoading(true);
    try {
      const stored = await loadJourneySession(intentId);
      if (!stored) {
        setError('Ace could not find this journey yet.');
        setSession(null);
        return;
      }
      setSession(stored);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [intentId]);

  useFocusEffect(useCallback(() => {
    void refreshSession();
  }, [refreshSession]));

  useEffect(() => {
    if (!session || !journeyIsLive(session)) return;
    const lookupId = statusLookupId(session);
    if (!lookupId) return;

    const interval = setInterval(() => {
      void (async () => {
        try {
          const data = await getIntentStatus(lookupId);
          const proof = data.metadata?.completionProof ?? {};
          const serverTrip = parseTripContext(data.metadata?.tripContext) ?? session.tripContext ?? null;
          const paymentConfirmed = paymentConfirmedFromMetadata(data.metadata);
          const nextTripContext = serverTrip
            ? syncTripBookingState(serverTrip, {
                phase: data.status === 'completed' || data.status === 'confirmed' || data.status === 'verified'
                  ? 'booked'
                  : data.status === 'failed' || data.status === 'expired' || data.status === 'rejected'
                  ? 'attention'
                  : serverTrip.phase,
                bookingConfirmed: ['completed', 'confirmed', 'verified'].includes(data.status),
                paymentConfirmed,
                paymentRequired: !!(session.fiatAmount && session.fiatAmount > 0),
                bookingRef: proof.bookingRef ?? session.bookingRef ?? undefined,
                origin: proof.fromStation ?? session.fromStation ?? undefined,
                destination: proof.toStation ?? session.toStation ?? undefined,
                departureTime: proof.departureDatetime ?? proof.departureTime ?? session.departureDatetime ?? session.departureTime ?? undefined,
                arrivalTime: proof.arrivalTime ?? session.arrivalTime ?? undefined,
                operator: proof.operator ?? session.operator ?? undefined,
                finalLegSummary: proof.finalLegSummary ?? session.finalLegSummary ?? undefined,
                failed: ['failed', 'expired', 'rejected'].includes(data.status),
              })
            : null;

          const nextSession: JourneySession = {
            ...session,
            intentId: data.intentId ?? session.intentId,
            jobId: session.jobId,
            title: nextTripContext?.title ?? session.title,
            state:
              ['failed', 'expired', 'rejected'].includes(data.status) ? 'attention'
              : nextTripContext?.phase === 'in_transit' ? 'in_transit'
              : nextTripContext?.phase === 'arrived' ? 'arriving'
              : nextTripContext?.watchState?.bookingState === 'payment_pending' ? 'payment_pending'
              : ['completed', 'confirmed', 'verified'].includes(data.status) ? 'ticketed'
              : session.state,
            bookingState: nextTripContext?.watchState?.bookingState ?? session.bookingState,
            fromStation: proof.fromStation ?? session.fromStation ?? null,
            toStation: proof.toStation ?? session.toStation ?? null,
            departureTime: proof.departureTime ?? session.departureTime ?? null,
            departureDatetime: proof.departureDatetime ?? session.departureDatetime ?? null,
            arrivalTime: proof.arrivalTime ?? session.arrivalTime ?? null,
            platform: proof.platform ?? session.platform ?? null,
            operator: proof.operator ?? session.operator ?? null,
            bookingRef: proof.bookingRef ?? session.bookingRef ?? null,
            finalLegSummary: proof.finalLegSummary ?? session.finalLegSummary ?? null,
            tripContext: nextTripContext ?? session.tripContext,
            shareToken: data.metadata?.shareToken ?? session.shareToken ?? null,
            walletPassUrl: data.metadata?.walletPassUrl ?? data.metadata?.appleWalletUrl ?? data.metadata?.passUrl ?? session.walletPassUrl ?? null,
            updatedAt: new Date().toISOString(),
          };

          await saveJourneySession(nextSession);
          setSession(nextSession);
        } catch {
          // keep the last durable session and stay calm
        }
      })();
    }, 8000);

    return () => clearInterval(interval);
  }, [session]);

  const cards = useMemo(() => tripCards(session?.tripContext), [session?.tripContext]);
  const tone = session ? sessionTone(session) : null;
  const routeLabel = session ? journeyDisplayRoute(session) : '';
  const repeatPrompt = session ? journeyPrimaryIntentPrompt(session) : null;

  const openReceipt = useCallback(() => {
    if (!session) return;
    router.push({
      pathname: '/(main)/receipt/[intentId]',
      params: {
        intentId: session.intentId,
        bookingRef: session.bookingRef ?? undefined,
        fromStation: session.fromStation ?? undefined,
        toStation: session.toStation ?? undefined,
        departureTime: session.departureTime ?? undefined,
        platform: session.platform ?? undefined,
        operator: session.operator ?? undefined,
        finalLegSummary: session.finalLegSummary ?? undefined,
        fiatAmount: session.fiatAmount != null ? String(session.fiatAmount) : undefined,
        currencySymbol: session.currencySymbol ?? undefined,
        currencyCode: session.currencyCode ?? undefined,
        tripContext: session.tripContext ? JSON.stringify(session.tripContext) : undefined,
        shareToken: session.shareToken ?? undefined,
        partnerCheckoutUrl: session.walletPassUrl?.endsWith('.pkpass') ? session.walletPassUrl : undefined,
      },
    });
  }, [session]);

  const openStatus = useCallback(() => {
    if (!session?.jobId) return;
    router.push({
      pathname: '/(main)/status/[jobId]',
      params: {
        jobId: session.jobId,
        intentId: session.intentId,
        fiatAmount: session.fiatAmount != null ? String(session.fiatAmount) : undefined,
        currencySymbol: session.currencySymbol ?? undefined,
        currencyCode: session.currencyCode ?? undefined,
        tripContext: session.tripContext ? JSON.stringify(session.tripContext) : undefined,
        shareToken: session.shareToken ?? undefined,
        journeyId: session.journeyId ?? undefined,
      },
    });
  }, [session]);

  const openWallet = useCallback(async () => {
    if (!session?.walletPassUrl) return;
    await Linking.openURL(session.walletPassUrl);
  }, [session?.walletPassUrl]);

  const openMap = useCallback(async () => {
    if (!session?.toStation) return;
    await Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(session.toStation)}`);
  }, [session?.toStation]);

  const askAce = useCallback(() => {
    const prompt = repeatPrompt ?? (routeLabel ? `${routeLabel.replace(' → ', ' to ')} next available` : undefined);
    router.replace({ pathname: '/(main)/converse', params: prompt ? { prefill: prompt } : undefined } as any);
  }, [repeatPrompt, routeLabel]);

  const handleCard = useCallback(async (card: (typeof cards)[number]) => {
    if (['delay_risk', 'connection_risk', 'platform_changed', 'gate_changed'].includes(card.kind)) {
      askAce();
      return;
    }
    if (card.kind === 'destination_suggestion' || card.kind === 'leave_now') {
      await openMap();
    }
  }, [askAce, openMap]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color="#93c5fd" style={{ marginTop: 120 }} />
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Journey not ready</Text>
          <Text style={styles.emptyBody}>{error ?? 'Ace could not find this journey yet.'}</Text>
          <Pressable onPress={() => router.replace('/(main)/converse')} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Back to Ace</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={C.textMuted} />
          </Pressable>
          <Text style={styles.headerTitle}>Journey</Text>
          <Pressable onPress={() => { void refreshSession(); }} hitSlop={12}>
            <Ionicons name="refresh-outline" size={18} color="#7f95aa" />
          </Pressable>
        </View>

        <View style={[styles.statePill, { backgroundColor: tone?.bg, borderColor: tone?.border }]}>
          <Text style={[styles.statePillText, { color: tone?.text }]}>{journeyStatusLabel(session)}</Text>
        </View>

        <Text style={styles.routeTitle}>{routeLabel}</Text>
        <Text style={styles.routeBody}>
          {session.finalLegSummary || session.tripContext?.watchState?.platformInfo || 'Ace is keeping this journey together for you.'}
        </Text>

        <View style={styles.summaryCard}>
          <SummaryRow label="Reference" value={session.bookingRef ?? 'Not issued yet'} />
          <SummaryRow label="Departs" value={session.departureTime ?? 'TBD'} />
          <SummaryRow label="Platform" value={session.platform ?? 'TBD'} />
          <SummaryRow label="Operator" value={session.operator ?? 'Ace is still checking'} />
          {session.fiatAmount != null && session.currencySymbol && (
            <SummaryRow
              label={session.state === 'payment_pending' ? 'Held fare' : 'Price'}
              value={`${session.currencySymbol}${session.fiatAmount.toFixed(2)} ${session.currencyCode ?? ''}`.trim()}
            />
          )}
        </View>

        {cards.length > 0 && (
          <View style={styles.cardsWrap}>
            {cards.slice(0, 3).map((card) => {
              const accent = card.severity === 'warning' ? '#f59e0b' : card.severity === 'success' ? '#4ade80' : '#60a5fa';
              const cta = journeyProactiveActionLabel(card);
              return (
                <View key={card.id} style={[styles.card, { borderColor: `${accent}33` }]}>
                  <View style={[styles.cardDot, { backgroundColor: accent }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{card.title}</Text>
                    <Text style={styles.cardBody}>{card.body}</Text>
                    {cta && (
                      <Pressable onPress={() => { void handleCard(card); }} style={styles.cardBtn}>
                        <Text style={styles.cardBtnText}>{cta}</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.actions}>
          {session.state === 'securing' || session.state === 'payment_pending' || session.state === 'attention' ? (
            <Pressable onPress={openStatus} style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>Open live handling</Text>
            </Pressable>
          ) : (
            <Pressable onPress={openReceipt} style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>Open receipt</Text>
            </Pressable>
          )}

          {session.walletPassUrl && (
            <Pressable onPress={() => { void openWallet(); }} style={styles.secondaryBtn}>
              <Ionicons name="wallet-outline" size={16} color="#cbe8ff" />
              <Text style={styles.secondaryBtnText}>Apple Wallet</Text>
            </Pressable>
          )}

          {session.toStation && (
            <Pressable onPress={() => { void openMap(); }} style={styles.secondaryBtn}>
              <Ionicons name="navigate-outline" size={16} color="#cbe8ff" />
              <Text style={styles.secondaryBtnText}>Navigate</Text>
            </Pressable>
          )}

          {session.shareToken && (
            <Pressable
              onPress={() => {
                void Linking.openURL(`https://api.agentpay.so/trip/view/${session.shareToken}`);
              }}
              style={styles.secondaryBtn}
            >
              <Ionicons name="people-outline" size={16} color="#cbe8ff" />
              <Text style={styles.secondaryBtnText}>Live share</Text>
            </Pressable>
          )}

          <Pressable onPress={askAce} style={styles.secondaryBtn}>
            <Ionicons name="sparkles-outline" size={16} color="#cbe8ff" />
            <Text style={styles.secondaryBtnText}>Ask Ace</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080808' },
  container: { padding: 24, paddingBottom: 80 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#f8fafc' },
  statePill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    marginBottom: 18,
  },
  statePillText: { fontSize: 12, fontWeight: '700' },
  routeTitle: { fontSize: 30, lineHeight: 36, letterSpacing: -0.8, color: '#f8fafc', fontWeight: '700', marginBottom: 10 },
  routeBody: { fontSize: 15, lineHeight: 22, color: '#8ea1b4', marginBottom: 20 },
  summaryCard: {
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 18,
    padding: 18,
    marginBottom: 18,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 20, marginBottom: 12 },
  summaryLabel: { fontSize: 12, color: '#7f95aa', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700' },
  summaryValue: { flex: 1, fontSize: 14, color: '#dcecff', textAlign: 'right', fontWeight: '600' },
  cardsWrap: { gap: 10, marginBottom: 18 },
  card: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  cardTitle: { fontSize: 13, color: '#f8fafc', fontWeight: '700', marginBottom: 3 },
  cardBody: { fontSize: 12, color: '#93a4b8', lineHeight: 18 },
  cardBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderRadius: 999,
    backgroundColor: '#111c2a',
    borderWidth: 1,
    borderColor: '#1e3a5f',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  cardBtnText: { fontSize: 12, fontWeight: '700', color: '#cbe8ff' },
  actions: { gap: 10 },
  primaryBtn: {
    backgroundColor: '#1d4ed8',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: '#eff6ff' },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
    paddingVertical: 13,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600', color: '#cbe8ff' },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#f8fafc', marginBottom: 10 },
  emptyBody: { fontSize: 14, lineHeight: 20, color: '#7f95aa', textAlign: 'center', marginBottom: 24 },
});
