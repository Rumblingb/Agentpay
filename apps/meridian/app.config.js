/**
 * Dynamic Expo config.
 * react-native-maps 1.18.0 does NOT ship a valid Expo config plugin.
 * Keys are injected directly into native config instead.
 *
 * iOS  → ios.infoPlist.GMSApiKey   (read by GoogleMaps SDK at launch)
 * Android → android.config.googleMaps.apiKey  (written to AndroidManifest.xml by Expo)
 *
 * EAS secrets:
 *   GOOGLE_MAPS_IOS_API_KEY   → npx eas secret:create --name GOOGLE_MAPS_IOS_API_KEY
 *   GOOGLE_MAPS_ANDROID_KEY   → npx eas secret:create --name GOOGLE_MAPS_ANDROID_KEY
 */

// @ts-check

const iosKey = process.env.GOOGLE_MAPS_IOS_API_KEY ?? '';
const androidKey = process.env.GOOGLE_MAPS_ANDROID_KEY ?? '';

module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    infoPlist: {
      ...config.ios?.infoPlist,
      GMSApiKey: iosKey,
    },
  },
  android: {
    ...config.android,
    config: {
      ...(config.android?.config ?? {}),
      googleMaps: { apiKey: androidKey },
    },
  },
});
