/**
 * My Trips - past bookings history
 *
 * Reads from AsyncStorage (bro.trips) which is written by the receipt screen
 * every time a booking is confirmed. Tap any trip to re-open its receipt.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { loadTrips as loadTripsFromStorage, type TripEntry } from '../../lib/storage';
import { formatMoneyAmount } from '../../lib/money';

function repeatPrompt(trip: TripEntry): string | null {
  if (trip.fromStation && trip.toStation) {
    return `${trip.fromStation} to ${trip.toStation} again`;
  }
  if (trip.title) {
    return `${trip.title} again`;
  }
  return null;
}

function tripModeMeta(trip: TripEntry) {
  switch (trip.tripContext?.mode) {
    case 'flight':
      return { icon: 'airplane-outline', iconBg: '#172554', label: 'Flight' };
    case 'bus':
      return { icon: 'bus-outline', iconBg: '#1f2937', label: 'Coach' };
    case 'local':
      return { icon: 'subway-outline', iconBg: '#1f2937', label: 'Local' };
    case 'hotel':
      return { icon: 'bed-outline', iconBg: '#2d1b69', label: 'Stay' };
    case 'dining':
      return { icon: 'restaurant-outline', iconBg: '#3f1d2e', label: 'Dining' };
    case 'event':
      return { icon: 'ticket-outline', iconBg: '#3f2d0d', label: 'Event' };
    case 'mixed':
      return { icon: 'navigate-outline', iconBg: '#0f3d2e', label: 'Multi-leg' };
    case 'rail':
    default:
      return { icon: 'train-outline', iconBg: '#0a1a0a', label: 'Rail' };
  }
}

function tripMetaLine(trip: TripEntry) {
  const meta = tripModeMeta(trip);
  return [meta.label, trip.operator].filter(Boolean).join(' · ');
}

export default function TripsScreen() {
  const [trips, setTrips] = useState<TripEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTrips = async () => {
    try {
      setTrips(await loadTripsFromStorage());
    } catch {
      setTrips([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => { loadTrips(); }, []));

  const openReceipt = (trip: TripEntry) => {
    const params: Record<string, string> = { intentId: trip.intentId };
    if (trip.bookingRef) params.bookingRef = trip.bookingRef;
    if (trip.fromStation) params.fromStation = trip.fromStation;
    if (trip.toStation) params.toStation = trip.toStation;
    if (trip.departureTime) params.departureTime = trip.departureTime;
    if (trip.platform) params.platform = trip.platform;
    if (trip.operator) params.operator = trip.operator;
    if (trip.tripContext) params.tripContext = JSON.stringify(trip.tripContext);
    if (trip.shareToken) params.shareToken = trip.shareToken;
    router.push({ pathname: '/(main)/receipt/[intentId]', params });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color="#6366f1" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color="#4b5563" />
        </Pressable>
        <Text style={styles.title}>Journeys</Text>
        <View style={{ width: 22 }} />
      </View>

      {trips.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="navigate-circle-outline" size={52} color="#818cf8" style={styles.emptyIcon} />
          <Text style={styles.emptyTitle}>No journeys yet</Text>
          <Text style={styles.emptyBody}>Confirmed trips stay here so you can reopen them without explaining the route again.</Text>
          <Pressable onPress={() => router.replace('/(main)/converse')} style={styles.bookBtn}>
            <Text style={styles.bookBtnText}>Ask Ace</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(t) => t.intentId}
          contentContainerStyle={styles.list}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadTrips(); }}
              tintColor="#6366f1"
            />
          )}
          renderItem={({ item }) => <TripCard trip={item} onPress={() => openReceipt(item)} />}
        />
      )}
    </SafeAreaView>
  );
}

function TripCard({ trip, onPress }: { trip: TripEntry; onPress: () => void }) {
  const date = new Date(trip.savedAt);
  const dateStr = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const meta = tripModeMeta(trip);
  const metaLine = tripMetaLine(trip);
  const repeat = repeatPrompt(trip);

  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={[styles.cardLeft, { backgroundColor: meta.iconBg }]}>
        <Ionicons name={meta.icon as any} size={18} color="#e5e7eb" />
      </View>
      <View style={styles.cardBody}>
        {trip.fromStation && trip.toStation ? (
          <Text style={styles.cardRoute} numberOfLines={1}>
            {trip.fromStation} {'->'} {trip.toStation}
          </Text>
        ) : (
          <Text style={styles.cardRoute} numberOfLines={1}>{trip.title ?? 'Journey'}</Text>
        )}
        <View style={styles.cardMeta}>
          {metaLine ? (
            <Text style={styles.cardMetaText} numberOfLines={1}>{metaLine}</Text>
          ) : null}
          {trip.departureTime ? (
            <Text style={styles.cardMetaText}>{trip.departureTime}</Text>
          ) : null}
          {trip.bookingRef ? (
            <Text style={styles.cardRef} numberOfLines={1}>{trip.bookingRef}</Text>
          ) : null}
        </View>
        <Text style={styles.cardDate}>{dateStr}</Text>
        {repeat && (
          <Pressable
            onPress={() => router.replace({ pathname: '/(main)/converse', params: { prefill: repeat } } as any)}
            style={styles.repeatBtn}
          >
            <Ionicons name="refresh-outline" size={13} color="#93c5fd" />
            <Text style={styles.repeatBtnText}>Book again</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.cardRight}>
        {trip.fiatAmount != null && trip.currencySymbol ? (
          <Text style={styles.cardAmount}>
            {trip.currencySymbol}{formatMoneyAmount(Number(trip.fiatAmount), trip.currencyCode)}
          </Text>
        ) : (
          <Text style={styles.cardAmount}>{trip.amount}</Text>
        )}
        <Text style={styles.cardCurrency}>{trip.currencyCode ?? trip.currency}</Text>
        <Ionicons name="chevron-forward" size={16} color="#374151" style={{ marginTop: 6 }} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080808' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
  },
  title: { fontSize: 17, fontWeight: '700', color: '#f9fafb' },

  list: { padding: 16, gap: 10 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d0d0d',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    gap: 12,
  },
  cardLeft: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardRoute: { fontSize: 14, fontWeight: '600', color: '#f9fafb', marginBottom: 4 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' },
  cardMetaText: { fontSize: 12, color: '#6b7280' },
  cardRef: { fontSize: 11, color: '#4ade80', fontFamily: 'monospace' },
  cardDate: { fontSize: 11, color: '#374151' },
  repeatBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1e3a5f',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  repeatBtnText: { fontSize: 12, fontWeight: '600', color: '#93c5fd' },
  cardRight: { alignItems: 'flex-end' },
  cardAmount: { fontSize: 15, fontWeight: '700', color: '#f9fafb' },
  cardCurrency: { fontSize: 11, color: '#6b7280' },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyIcon: { marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#f9fafb', marginBottom: 8 },
  emptyBody: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20, marginBottom: 32 },
  bookBtn: {
    backgroundColor: '#111',
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  bookBtnText: { fontSize: 15, fontWeight: '600', color: '#818cf8' },
});
