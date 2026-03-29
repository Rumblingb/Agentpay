import * as Location from 'expo-location';

import { findNearestStation, type StationGeo } from './stationGeo';
import { loadConsents } from './profile';

export async function getNearestStation(): Promise<StationGeo | null> {
  try {
    const consents = await loadConsents();
    if (consents && !consents.locationConsented) {
      return null;
    }

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
