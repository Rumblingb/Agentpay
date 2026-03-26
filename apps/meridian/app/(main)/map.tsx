/**
 * Atlas — Bro's map screen
 *
 * Two modes:
 *   Navigate  — active route polyline + step-by-step card
 *               Auto-advances step when within 30 m of step endpoint.
 *   Explore   — nearby place markers with callouts
 *               Voice button calls planIntent with current GPS.
 *
 * Receives params (JSON strings) from converse.tsx via router.push:
 *   routeData   — ConciergePlanItem.routeData (navigate mode)
 *   places      — JSON array of nearby places (explore mode, optional)
 *
 * react-native-maps is required — new EAS build needed to test on device.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  SafeAreaView,
  Animated,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import MapView, { Polyline, Marker, PROVIDER_GOOGLE } from 'react-native-maps';

import { C } from '../../lib/theme';
import { planIntent } from '../../lib/concierge';
import { loadProfileRaw } from '../../lib/profile';
import { useStore } from '../../lib/store';
import {
  decodePolyline,
  buildNavSteps,
  speakStep,
  regionForCoords,
  formatDistance,
  distanceTo,
  type LatLng,
  type NavStep,
} from '../../lib/maps';

// ── Types ──────────────────────────────────────────────────────────────────

interface RouteData {
  polylineEncoded: string;
  durationSeconds: number;
  distanceMeters: number;
  steps: Array<{ instruction: string; distanceMeters: number; durationSeconds: number }>;
}

interface NearbyPlace {
  name: string;
  address: string;
  rating?: number;
  lat?: number;
  lon?: number;
}

// ── Dark map style ─────────────────────────────────────────────────────────

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#060d18' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#03070f' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#0f1f35' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#1a3050' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0c2a40' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#060d18' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#10172e' }] },
];

// ── Screen ─────────────────────────────────────────────────────────────────

export default function MapScreen() {
  const params = useLocalSearchParams<{ routeData?: string; places?: string }>();

  const routeData: RouteData | null = params.routeData
    ? tryParse<RouteData>(params.routeData)
    : null;
  const nearbyPlaces: NearbyPlace[] = params.places
    ? tryParse<NearbyPlace[]>(params.places) ?? []
    : [];

  const mode = routeData ? 'navigate' : 'explore';

  // Route state
  const polylineCoords = routeData ? decodePolyline(routeData.polylineEncoded) : [];
  const navSteps = routeData ? buildNavSteps(routeData.steps) : [];
  const [stepIndex, setStepIndex]     = useState(0);
  const [userCoords, setUserCoords]   = useState<LatLng | null>(null);

  // Voice state
  const [voiceActive, setVoiceActive] = useState(false);
  const { agentId: hirerId }           = useStore();
  const mapRef                        = useRef<MapView>(null);

  // Bottom sheet animation
  const sheetAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(sheetAnim, { toValue: 1, useNativeDriver: true, tension: 60 }).start();
  }, []);

  // Fit map to route on load
  useEffect(() => {
    if (!mapRef.current) return;
    if (polylineCoords.length > 0) {
      const region = regionForCoords(polylineCoords);
      mapRef.current.animateToRegion(region, 600);
    }
  }, [polylineCoords.length]);

  // GPS watch — auto-advance step within 30 m
  useEffect(() => {
    if (mode !== 'navigate' || navSteps.length === 0) return;
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
        (pos) => {
          const coords: LatLng = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          };
          setUserCoords(coords);

          const currentStep = navSteps[stepIndex];
          if (!currentStep) return;

          // Build step endpoint from polyline segment midpoint (approximate)
          const segmentEnd = polylineCoords[Math.min(
            Math.round(((stepIndex + 1) / navSteps.length) * polylineCoords.length),
            polylineCoords.length - 1
          )];
          if (!segmentEnd) return;

          if (distanceTo(coords, segmentEnd) < 30) {
            const next = stepIndex + 1;
            if (next < navSteps.length) {
              setStepIndex(next);
              speakStep(navSteps[next]!);
            }
          }
        }
      );
    })();

    return () => { sub?.remove(); };
  }, [mode, stepIndex, navSteps.length]);

  // Speak first step on mount
  useEffect(() => {
    if (mode === 'navigate' && navSteps.length > 0) {
      speakStep(navSteps[0]!);
    }
  }, []);

  // Voice button — asks Bro with current GPS
  const handleVoice = useCallback(async () => {
    if (!hirerId || voiceActive) return;
    setVoiceActive(true);
    try {
      const profile = await loadProfileRaw();
      const travelProfile: Record<string, unknown> = {
        ...(profile ?? {}),
        currentLat: userCoords?.latitude,
        currentLon: userCoords?.longitude,
      };
      await planIntent({ transcript: '', hirerId: hirerId ?? '', travelProfile });
    } catch {
      // silent — user stays on map
    } finally {
      setVoiceActive(false);
    }
  }, [hirerId, voiceActive, userCoords]);

  const currentStep: NavStep | undefined = navSteps[stepIndex];
  const remainingSteps = navSteps.length - stepIndex;
  const remainingMins = currentStep
    ? Math.round(navSteps.slice(stepIndex).reduce((s, x) => s + x.durationSeconds, 0) / 60)
    : Math.round((routeData?.durationSeconds ?? 0) / 60);

  return (
    <SafeAreaView style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        customMapStyle={DARK_MAP_STYLE}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {/* Route polyline — glowing emerald line */}
        {polylineCoords.length > 0 && (
          <Polyline
            coordinates={polylineCoords}
            strokeColor="#4ade80"
            strokeWidth={4}
          />
        )}

        {/* Destination marker */}
        {polylineCoords.length > 0 && (
          <Marker
            coordinate={polylineCoords[polylineCoords.length - 1]!}
            pinColor="#f87171"
          />
        )}

        {/* Nearby place markers */}
        {nearbyPlaces.map((p, i) =>
          p.lat != null && p.lon != null ? (
            <Marker
              key={i}
              coordinate={{ latitude: p.lat, longitude: p.lon }}
              pinColor="#34d399"
              title={p.name}
              description={p.rating ? `★ ${p.rating.toFixed(1)}` : p.address}
            />
          ) : null
        )}
      </MapView>

      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color={C.textPrimary} />
        </Pressable>
        <View style={[styles.modeBadge, mode === 'navigate' ? styles.badgeNav : styles.badgeExplore]}>
          <Text style={styles.modeBadgeText}>
            {mode === 'navigate' ? 'Navigate' : 'Explore'}
          </Text>
        </View>
      </View>

      {/* Bottom sheet */}
      <Animated.View
        style={[
          styles.sheet,
          { transform: [{ translateY: sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [220, 0] }) }] },
        ]}
      >
        {mode === 'navigate' && currentStep ? (
          <NavigateCard
            step={currentStep}
            stepIndex={stepIndex}
            remainingSteps={remainingSteps}
            remainingMins={remainingMins}
            totalDistance={routeData?.distanceMeters ?? 0}
          />
        ) : (
          <ExploreCard places={nearbyPlaces} />
        )}
      </Animated.View>

      {/* Mini voice button */}
      <Pressable
        style={[styles.voiceBtn, voiceActive && styles.voiceBtnActive]}
        onPress={() => void handleVoice()}
      >
        {voiceActive
          ? <ActivityIndicator color={C.emBright} size="small" />
          : <Ionicons name="mic-outline" size={22} color={C.emBright} />
        }
      </Pressable>
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function NavigateCard({
  step,
  stepIndex,
  remainingSteps,
  remainingMins,
  totalDistance,
}: {
  step: NavStep;
  stepIndex: number;
  remainingSteps: number;
  remainingMins: number;
  totalDistance: number;
}) {
  return (
    <View style={styles.navCard}>
      <Text style={styles.navInstruction}>{step.instruction}</Text>
      <View style={styles.navMeta}>
        <View style={styles.navMetaItem}>
          <Ionicons name="walk-outline" size={14} color={C.textMuted} />
          <Text style={styles.navMetaText}>{formatDistance(step.distanceMeters)}</Text>
        </View>
        <View style={styles.navMetaItem}>
          <Ionicons name="time-outline" size={14} color={C.textMuted} />
          <Text style={styles.navMetaText}>{remainingMins} min left</Text>
        </View>
        <View style={styles.navMetaItem}>
          <Ionicons name="flag-outline" size={14} color={C.textMuted} />
          <Text style={styles.navMetaText}>{remainingSteps} steps</Text>
        </View>
      </View>
    </View>
  );
}

function ExploreCard({ places }: { places: NearbyPlace[] }) {
  if (places.length === 0) {
    return (
      <View style={styles.exploreEmpty}>
        <Text style={styles.exploreEmptyText}>Ask Bro to find something nearby</Text>
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.placesList}
    >
      {places.map((p, i) => (
        <View key={i} style={styles.placeCard}>
          <Text style={styles.placeName} numberOfLines={1}>{p.name}</Text>
          {p.rating != null && (
            <Text style={styles.placeRating}>★ {p.rating.toFixed(1)}</Text>
          )}
          <Text style={styles.placeAddress} numberOfLines={2}>{p.address}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function tryParse<T>(json: string): T | null {
  try { return JSON.parse(json) as T; } catch { return null; }
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },

  // Top bar
  topBar: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(6,13,24,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.borderMd,
  },
  modeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  badgeNav: {
    backgroundColor: 'rgba(5,46,22,0.85)',
    borderWidth: 1,
    borderColor: C.emGlow,
  },
  badgeExplore: {
    backgroundColor: 'rgba(12,42,64,0.85)',
    borderWidth: 1,
    borderColor: C.skyDim,
  },
  modeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: C.emBright,
    letterSpacing: 0.5,
  },

  // Bottom sheet
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(6,13,24,0.96)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: C.borderMd,
    paddingBottom: 32,
  },

  // Navigate card
  navCard: {
    padding: 20,
  },
  navInstruction: {
    fontSize: 17,
    fontWeight: '600',
    color: C.textPrimary,
    lineHeight: 24,
    marginBottom: 12,
  },
  navMeta: {
    flexDirection: 'row',
    gap: 16,
  },
  navMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  navMetaText: {
    fontSize: 13,
    color: C.textMuted,
  },

  // Explore card
  exploreEmpty: {
    padding: 20,
    alignItems: 'center',
  },
  exploreEmptyText: {
    fontSize: 14,
    color: C.textMuted,
  },
  placesList: {
    padding: 16,
    gap: 10,
  },
  placeCard: {
    width: 160,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    marginRight: 10,
  },
  placeName: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 2,
  },
  placeRating: {
    fontSize: 12,
    color: C.emBright,
    marginBottom: 4,
  },
  placeAddress: {
    fontSize: 11,
    color: C.textMuted,
    lineHeight: 15,
  },

  // Voice button
  voiceBtn: {
    position: 'absolute',
    bottom: 170,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.emDim,
    borderWidth: 1,
    borderColor: C.emGlow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBtnActive: {
    backgroundColor: C.emMid,
    borderColor: C.emBright,
  },
});
