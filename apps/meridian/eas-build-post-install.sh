#!/bin/bash
# Runs automatically after npm install on EAS Build servers.
# Patches ExpoModulesCorePlugin.gradle for AGP 8.5+ compatibility.
# Root cause: `from components.release` is accessed synchronously but AGP 8.5+
# registers software components lazily. Wrapping in afterEvaluate defers access.

PLUGIN_PATH="$EAS_BUILD_WORKINGDIR/apps/meridian/node_modules/expo-modules-core/android/ExpoModulesCorePlugin.gradle"

if [ ! -f "$PLUGIN_PATH" ]; then
  echo "ExpoModulesCorePlugin.gradle not found at $PLUGIN_PATH, skipping patch"
  exit 0
fi

if grep -q "afterEvaluate { from components.release }" "$PLUGIN_PATH"; then
  echo "✓ ExpoModulesCorePlugin.gradle already patched"
  exit 0
fi

if grep -q "from components.release" "$PLUGIN_PATH"; then
  sed -i 's/from components\.release/afterEvaluate { from components.release }/g' "$PLUGIN_PATH"
  echo "✓ Patched ExpoModulesCorePlugin.gradle — deferred components.release for AGP 8.5+"
else
  echo "⚠ 'from components.release' not found — patch may not be needed"
fi
