/**
 * Dynamic Expo config.
 * react-native-maps 1.18.0 does NOT ship a valid Expo config plugin.
 * Android keys are injected directly into native config instead.
 * iOS falls back to Apple Maps unless a Google Maps key is intentionally set.
 *
 * Android → android.config.googleMaps.apiKey  (written to AndroidManifest.xml by Expo)
 *
 * EAS secrets:
 *   GOOGLE_MAPS_IOS_API_KEY   → npx eas secret:create --name GOOGLE_MAPS_IOS_API_KEY
 *   GOOGLE_MAPS_ANDROID_KEY   → npx eas secret:create --name GOOGLE_MAPS_ANDROID_KEY
 */

// @ts-check

const iosKey = (process.env.GOOGLE_MAPS_IOS_API_KEY ?? '').trim();
const androidKey = (process.env.GOOGLE_MAPS_ANDROID_KEY ?? '').trim();

module.exports = ({ config }) => {
  const nextConfig = {
    ...config,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
      },
    },
    android: {
      ...config.android,
      config: {
        ...(config.android?.config ?? {}),
      },
    },
  };

  if (iosKey) {
    nextConfig.ios.infoPlist.GMSApiKey = iosKey;
  }

  if (androidKey) {
    nextConfig.android.config.googleMaps = { apiKey: androidKey };
  }

  return nextConfig;
};
