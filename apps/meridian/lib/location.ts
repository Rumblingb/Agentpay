import * as Location from 'expo-location';

import { findNearestStation, type StationGeo } from './stationGeo';
import { loadConsents } from './profile';

export type LocationContext = {
  nearestStation: StationGeo | null;
  placeLabel: string | null;
};

function formatPlaceLabel(
  geocode: Location.LocationGeocodedAddress | null | undefined,
): string | null {
  if (!geocode) return null;
  const parts = [
    geocode.district,
    geocode.city,
    geocode.subregion,
  ].filter((value, index, arr) => !!value && arr.indexOf(value) === index);
  return parts.length > 0 ? parts.slice(0, 2).join(', ') : null;
}

export async function getNearestStation(): Promise<StationGeo | null> {
  const context = await getLocationContext();
  return context.nearestStation;
}

export async function getLocationContext(): Promise<LocationContext> {
  try {
    const consents = await loadConsents();
    if (consents && !consents.locationConsented) {
      return { nearestStation: null, placeLabel: null };
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return { nearestStation: null, placeLabel: null };
    }

    const position =
      await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      }).catch(async () =>
        Location.getLastKnownPositionAsync({
          maxAge: 60_000,
          requiredAccuracy: 150,
        }),
      );

    if (!position) {
      return { nearestStation: null, placeLabel: null };
    }

    const [place] = await Location.reverseGeocodeAsync({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    }).catch(() => []);

    return {
      nearestStation: findNearestStation(position.coords.latitude, position.coords.longitude),
      placeLabel: formatPlaceLabel(place),
    };
  } catch {
    return { nearestStation: null, placeLabel: null };
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
