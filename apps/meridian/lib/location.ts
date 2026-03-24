/**
 * location.ts — GPS wrapper for nearest-station detection
 *
 * Wraps expo-location. Asks for permission only if not yet granted.
 * Returns the nearest UK station or null (user out of range / no permission).
 */

import * as Location from 'expo-location';
import { findNearestStation, type StationGeo } from './stationGeo';

/**
 * Get the user's nearest station.
 * Silently returns null if permission denied or outside UK.
 */
export async function getNearestStation(): Promise<StationGeo | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced, // fast enough; no need for GPS precision
    });

    return findNearestStation(loc.coords.latitude, loc.coords.longitude);
  } catch {
    return null;
  }
}

/**
 * Check if permission is already granted without prompting.
 */
export async function hasLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}
