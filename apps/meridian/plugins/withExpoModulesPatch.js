/**
 * Expo config plugin: two fixes applied during `expo prebuild` before Gradle runs.
 *
 * Fix 1 — ExpoModulesCorePlugin.gradle for AGP 8.5+:
 *   In AGP 8.5+, software components are registered lazily. `components.release`
 *   is not available even inside `project.afterEvaluate`. The fix is to double-nest:
 *   `project.afterEvaluate { publishing { ... } }` becomes
 *   `project.afterEvaluate { project.afterEvaluate { publishing { ... } } }`
 *   so the component lookup runs after all projects have evaluated.
 *
 * Fix 2 — Gradle wrapper version:
 *   expo prebuild generates Gradle 8.6 (from the RN template), but AGP 8.5+ requires
 *   Gradle 8.7+. Patching the wrapper to 8.10.2 satisfies the requirement.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withExpoModulesPatch = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;

      // ── Fix 1: ExpoModulesCorePlugin.gradle ─────────────────────────────

      let pluginPath;
      try {
        const pkgJson = require.resolve('expo-modules-core/package.json', {
          paths: [projectRoot, __dirname],
        });
        pluginPath = path.join(path.dirname(pkgJson), 'android', 'ExpoModulesCorePlugin.gradle');
      } catch (e) {
        console.log('[withExpoModulesPatch] expo-modules-core not found:', e.message);
      }

      if (pluginPath && fs.existsSync(pluginPath)) {
        let content = fs.readFileSync(pluginPath, 'utf8');

        // Check if already double-nested (our final state)
        // The `from components.release` line is used only for local Maven publishing,
        // not needed for building the app. AGP 8.5+ registers components lazily and
        // this line fails at any evaluation depth. Remove it entirely.
        if (!content.includes('from components.release') &&
            !content.includes('afterEvaluate { from components.release }')) {
          console.log('[withExpoModulesPatch] ✓ ExpoModulesCorePlugin already patched (line removed)');
        } else {
          // Remove the line (handle both original and a previous partial patch)
          content = content
            .replace(/\s*afterEvaluate \{ from components\.release \}\n/g, '\n')
            .replace(/\s*from components\.release\n/g, '\n');
          fs.writeFileSync(pluginPath, content);
          console.log('[withExpoModulesPatch] ✓ Removed components.release line from ExpoModulesCorePlugin.gradle');
        }
      }

      // ── Fix 2: Gradle wrapper → 8.10.2 ──────────────────────────────────

      const gradleWrapperPath = path.join(
        projectRoot,
        'android',
        'gradle',
        'wrapper',
        'gradle-wrapper.properties',
      );

      if (fs.existsSync(gradleWrapperPath)) {
        let wrapperContent = fs.readFileSync(gradleWrapperPath, 'utf8');
        const targetVersion = 'gradle-8.10.2-all.zip';

        if (wrapperContent.includes(targetVersion)) {
          console.log('[withExpoModulesPatch] ✓ Gradle wrapper already at 8.10.2');
        } else {
          wrapperContent = wrapperContent.replace(
            /gradle-\d+\.\d+(?:\.\d+)?-(?:all|bin)\.zip/,
            targetVersion,
          );
          fs.writeFileSync(gradleWrapperPath, wrapperContent);
          console.log('[withExpoModulesPatch] ✓ Patched gradle-wrapper to 8.10.2');
        }
      } else {
        console.log('[withExpoModulesPatch] ⚠ gradle-wrapper.properties not found');
      }

      return config;
    },
  ]);
};

const withExpoModulesPatchIOS = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;

      let invokerPath;
      try {
        const pkgJson = require.resolve('expo-modules-core/package.json', {
          paths: [projectRoot, __dirname],
        });
        invokerPath = path.join(
          path.dirname(pkgJson),
          'common',
          'cpp',
          'TestingSyncJSCallInvoker.h',
        );
      } catch (e) {
        console.log('[withExpoModulesPatch] expo-modules-core not found for iOS patch:', e.message);
        return config;
      }

      if (!fs.existsSync(invokerPath)) {
        console.log('[withExpoModulesPatch] ⚠ TestingSyncJSCallInvoker.h not found');
        return config;
      }

      let hContent = fs.readFileSync(invokerPath, 'utf8');
      if (hContent.includes('#if REACT_NATIVE_TARGET_VERSION >= 75')) {
        hContent = hContent
          .replace('#if REACT_NATIVE_TARGET_VERSION >= 75\n', '')
          .replace(
            /\n#else\n  void invokeAsync\(std::function<void\(\)> &&func\) noexcept override \{\n    func\(\);\n  \}\n\n  void invokeSync\(std::function<void\(\)> &&func\) override \{\n    func\(\);\n  \}\n#endif/,
            '',
          );
        fs.writeFileSync(invokerPath, hContent);
        console.log('[withExpoModulesPatch] ✓ Patched TestingSyncJSCallInvoker.h for RN 0.76+');
      } else {
        console.log('[withExpoModulesPatch] ✓ TestingSyncJSCallInvoker.h already patched');
      }

      return config;
    },
  ]);
};

const withExpoModulesFullPatch = (config) => {
  config = withExpoModulesPatch(config);
  config = withExpoModulesPatchIOS(config);
  return config;
};

module.exports = withExpoModulesFullPatch;
