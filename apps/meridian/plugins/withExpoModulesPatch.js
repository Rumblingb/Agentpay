/**
 * Expo config plugin: patches ExpoModulesCorePlugin.gradle for AGP 8.5+ compatibility.
 *
 * AGP 8.5+ registers SoftwareComponents lazily. Wrapping `from components.release`
 * in an inner `afterEvaluate` defers the lookup until the component is registered.
 *
 * This runs as part of `expo prebuild` (withDangerousMod), patching the file
 * after the android project is generated but before Gradle runs.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withExpoModulesPatch = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      // expo-modules-core is hoisted to workspace root or lives in node_modules
      let pluginPath;
      try {
        const pkgJson = require.resolve('expo-modules-core/package.json', {
          paths: [config.modRequest.projectRoot, __dirname],
        });
        pluginPath = path.join(path.dirname(pkgJson), 'android', 'ExpoModulesCorePlugin.gradle');
      } catch (e) {
        console.log('[withExpoModulesPatch] expo-modules-core not found:', e.message);
        return config;
      }

      if (!fs.existsSync(pluginPath)) {
        console.log('[withExpoModulesPatch] ExpoModulesCorePlugin.gradle not found at:', pluginPath);
        return config;
      }

      let content = fs.readFileSync(pluginPath, 'utf8');

      if (content.includes('afterEvaluate { from components.release }')) {
        console.log('[withExpoModulesPatch] ✓ already patched');
      } else if (content.includes('from components.release')) {
        content = content.replace(
          /from components\.release/g,
          'afterEvaluate { from components.release }'
        );
        fs.writeFileSync(pluginPath, content);
        console.log('[withExpoModulesPatch] ✓ patched ExpoModulesCorePlugin.gradle for AGP 8.5+');
      } else {
        console.log('[withExpoModulesPatch] ⚠ "from components.release" not found — may already be fixed upstream');
      }

      return config;
    },
  ]);
};

module.exports = withExpoModulesPatch;
