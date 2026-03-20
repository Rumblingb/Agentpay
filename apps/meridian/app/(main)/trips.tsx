/**
 * My Trips — past bookings history
 *
 * Reads from AsyncStorage (bro.trips) which is written by the receipt screen
 * every time a booking is confirmed. Tap any trip to re-open its receipt.
 */

import React, { useEffect, useState, useCallback } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';

interface TripEntry {
  intentId:      string;
  bookingRef:    string | null;
  fromStation:   string | null;
  toStation:     string | null;
  departureTime: string | null;
  platform:      string | null;
  operator:      string | null;
  amount:        string | number;
  currency:      string;
  /** Fiat display fields — always shown to user, never USDC */
  fiatAmount?:     number | null;
  currencySymbol?: string | null;
  currencyCode?:   string | null;
  savedAt:       string;
}

export default function TripsScreen() {
  const [trips,     setTrips]     = useState<TripEntry[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTrips = async () => {
    try {
      const raw = await AsyncStorage.getItem('bro.trips');
      setTrips(raw ? JSON.parse(raw) : []);
    } catch {
      setTrips([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Reload every time this screen comes into focus
  useFocusEffect(useCallback(() => { loadTrips(); }, []));

  const openReceipt = (trip: TripEntry) => {
    const params: Record<string, string> = { intentId: trip.intentId };
    if (trip.bookingRef)    params.bookingRef    = trip.bookingRef;
    if (trip.fromStation)   params.fromStation   = trip.fromStation;
    if (trip.toStation)     params.toStation     = trip.toStation;
    if (trip.departureTime) params.departureTime = trip.departureTime;
    if (trip.platform)      params.platform      = trip.platform;
    if (trip.operator)      params.operator      = trip.operator;
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
        <Text style={styles.title}>My Trips</Text>
        <View style={{ width: 22 }} />
      </View>

      {trips.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🚂</Text>
          <Text style={styles.emptyTitle}>No trips yet</Text>
          <Text style={styles.emptyBody}>Your travel requests will appear here.</Text>
          <Pressable onPress={() => router.replace('/(main)/converse')} style={styles.bookBtn}>
            <Text style={styles.bookBtnText}>Book a trip</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={t => t.intentId}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadTrips(); }}
              tintColor="#6366f1"
            />
          }
          renderItem={({ item }) => <TripCard trip={item} onPress={() => openReceipt(item)} />}
        />
      )}
    </SafeAreaView>
  );
}

function TripCard({ trip, onPress }: { trip: TripEntry; onPress: () => void }) {
  const date = new Date(trip.savedAt);
  const dateStr = date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={styles.cardLeft}>
        <Text style={styles.cardIcon}>🚂</Text>
      </View>
      <View style={styles.cardBody}>
        {trip.fromStation && trip.toStation ? (
          <Text style={styles.cardRoute} numberOfLines={1}>
            {trip.fromStation} → {trip.toStation}
          </Text>
        ) : (
          <Text style={styles.cardRoute} numberOfLines={1}>Train booking</Text>
        )}
        <View style={styles.cardMeta}>
          {trip.departureTime && (
            <Text style={styles.cardMetaText}>{trip.departureTime}</Text>
          )}
          {trip.bookingRef && (
            <Text style={styles.cardRef} numberOfLines={1}>{trip.bookingRef}</Text>
          )}
        </View>
        <Text style={styles.cardDate}>{dateStr}</Text>
      </View>
      <View style={styles.cardRight}>
        {trip.fiatAmount != null && trip.currencySymbol ? (
          <Text style={styles.cardAmount}>
            {trip.currencySymbol}{trip.currencyCode === 'INR'
              ? Math.round(trip.fiatAmount).toLocaleString('en-IN')
              : Number(trip.fiatAmount).toFixed(2)}
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
    backgroundColor: '#0a1a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIcon:   { fontSize: 18 },
  cardBody:   { flex: 1 },
  cardRoute:  { fontSize: 14, fontWeight: '600', color: '#f9fafb', marginBottom: 4 },
  cardMeta:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  cardMetaText: { fontSize: 12, color: '#6b7280' },
  cardRef:    { fontSize: 11, color: '#4ade80', fontFamily: 'monospace' },
  cardDate:   { fontSize: 11, color: '#374151' },
  cardRight:  { alignItems: 'flex-end' },
  cardAmount: { fontSize: 15, fontWeight: '700', color: '#f9fafb' },
  cardCurrency: { fontSize: 11, color: '#6b7280' },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyIcon:  { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#f9fafb', marginBottom: 8 },
  emptyBody:  { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20, marginBottom: 32 },
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
