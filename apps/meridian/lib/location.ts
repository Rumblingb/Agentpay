import * as Location from 'expo-location';

import { findNearestStation, type StationGeo } from './stationGeo';

export async function getNearestStation(): Promise<StationGeo | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return null;
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return findNearestStation(position.coords.latitude, position.coords.longitude);
  } catch {
    return null;
  }
}

export async function getLocationPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted' || status === 'denied' || status === 'undetermined') {
      return status;
    }
  } catch {
    return 'undetermined';
  }

  return 'undetermined';
}
