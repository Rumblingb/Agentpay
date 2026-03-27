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
const appJson = require('./app.json');

const iosKey     = process.env.GOOGLE_MAPS_IOS_API_KEY  ?? '';
const androidKey = process.env.GOOGLE_MAPS_ANDROID_KEY  ?? '';

module.exports = {
  ...appJson,
  expo: {
    ...appJson.expo,
    ios: {
      ...appJson.expo.ios,
      infoPlist: {
        ...appJson.expo.ios.infoPlist,
        GMSApiKey: iosKey,
      },
    },
    android: {
      ...appJson.expo.android,
      config: {
        googleMaps: { apiKey: androidKey },
      },
    },
    // plugins stays exactly as in app.json — no react-native-maps entry
    plugins: appJson.expo.plugins,
    updates: {
      url: 'https://u.expo.dev/17f2ea0c-cced-4664-bc42-36c0583bf021',
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
  },
};
