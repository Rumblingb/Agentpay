/**
 * Map utilities for Bro's Atlas screen.
 *
 * Pure TypeScript — no native dependencies.
 * Uses speakBro (ElevenLabs) for turn-by-turn voice instructions.
 */

import { speakBro } from './tts';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface NavStep {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  endLat?: number;
  endLon?: number;
}

// ── Polyline ───────────────────────────────────────────────────────────────

/**
 * Decode a Google encoded polyline string into an array of {latitude, longitude}.
 * Standard algorithm — O(n) in encoded length.
 */
export function decodePolyline(encoded: string): LatLng[] {
  const coords: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    // Decode latitude
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    // Decode longitude
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return coords;
}

// ── Navigation steps ───────────────────────────────────────────────────────

/**
 * Convert raw RouteStep objects (from concierge) into NavSteps with clean text.
 * Strips residual HTML tags that Google Routes API may include.
 */
export function buildNavSteps(
  steps: Array<{ instruction: string; distanceMeters: number; durationSeconds: number }>
): NavStep[] {
  return steps.map((s) => ({
    instruction: s.instruction.replace(/<[^>]+>/g, '').trim(),
    distanceMeters: s.distanceMeters,
    durationSeconds: s.durationSeconds,
  }));
}

/**
 * Speak a navigation step via ElevenLabs (Bro voice).
 * Prefixes short distances with "In X metres".
 */
export function speakStep(step: NavStep): void {
  const prefix = step.distanceMeters < 500
    ? `In ${formatDistanceSpeech(step.distanceMeters)}, `
    : '';
  void speakBro(`${prefix}${step.instruction}`);
}

// ── Distance formatting ────────────────────────────────────────────────────

/** Display distance for UI labels ("200 m", "1.2 km") */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Speech-optimised distance ("200 metres", "1.2 kilometres") */
function formatDistanceSpeech(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} metres`;
  return `${(meters / 1000).toFixed(1)} kilometres`;
}

// ── Map region ─────────────────────────────────────────────────────────────

const MIN_DELTA = 0.005; // ~500 m padding

/**
 * Compute a MapRegion bounding box that fits all provided coordinates.
 * Adds 20% padding so the route is never clipped at the edge of the viewport.
 */
export function regionForCoords(coords: LatLng[]): MapRegion {
  if (coords.length === 0) {
    return { latitude: 51.5, longitude: -0.12, latitudeDelta: 0.05, longitudeDelta: 0.05 };
  }

  let minLat = coords[0]!.latitude;
  let maxLat = coords[0]!.latitude;
  let minLng = coords[0]!.longitude;
  let maxLng = coords[0]!.longitude;

  for (const c of coords) {
    if (c.latitude < minLat) minLat = c.latitude;
    if (c.latitude > maxLat) maxLat = c.latitude;
    if (c.longitude < minLng) minLng = c.longitude;
    if (c.longitude > maxLng) maxLng = c.longitude;
  }

  const latDelta = Math.max((maxLat - minLat) * 1.2, MIN_DELTA);
  const lngDelta = Math.max((maxLng - minLng) * 1.2, MIN_DELTA);

  return {
    latitude:      (minLat + maxLat) / 2,
    longitude:     (minLng + maxLng) / 2,
    latitudeDelta:  latDelta,
    longitudeDelta: lngDelta,
  };
}

// ── Haversine distance (for step auto-advance) ────────────────────────────

/**
 * Great-circle distance in metres between two points.
 * Used to detect when user is within 30 m of a step endpoint.
 */
export function distanceTo(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const R = 6_371_000;
  const φ1 = (a.latitude * Math.PI) / 180;
  const φ2 = (b.latitude * Math.PI) / 180;
  const Δφ = ((b.latitude - a.latitude) * Math.PI) / 180;
  const Δλ = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
