/**
 * Exclude expo-dev-launcher from autolinking on all platforms.
 * It gets hoisted to root node_modules during EAS monorepo installs
 * but is only needed for development builds (developmentClient: true).
 * Without this, its Gradle plugin applies itself and fails on release builds.
 */
module.exports = {
  dependencies: {
    'expo-dev-launcher': {
      platforms: {
        android: null,
        ios: null,
      },
    },
  },
};
