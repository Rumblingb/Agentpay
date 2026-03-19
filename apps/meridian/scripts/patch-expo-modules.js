#!/usr/bin/env node
/**
 * Patches ExpoModulesCorePlugin.gradle for AGP 8.5+ / Gradle 8.10.2 compatibility.
 * Uses require.resolve to find expo-modules-core regardless of workspace hoisting.
 *
 * Root cause: `from components.release` is called during project evaluation but
 * AGP 8.5+ registers software components lazily. Wrapping in afterEvaluate defers it.
 */
const fs = require('fs');
const path = require('path');

let pluginPath;
try {
  const pkgJson = require.resolve('expo-modules-core/package.json');
  pluginPath = path.join(path.dirname(pkgJson), 'android', 'ExpoModulesCorePlugin.gradle');
  console.log('expo-modules-core found at:', path.dirname(pkgJson));
} catch (e) {
  console.log('expo-modules-core not found via require.resolve:', e.message);
  process.exit(0);
}

if (!fs.existsSync(pluginPath)) {
  console.log('ExpoModulesCorePlugin.gradle not found at:', pluginPath);
  process.exit(0);
}

let content = fs.readFileSync(pluginPath, 'utf8');

if (content.includes('afterEvaluate { from components.release }')) {
  console.log('✓ ExpoModulesCorePlugin.gradle already patched');
} else if (content.includes('from components.release')) {
  content = content.replace(/from components\.release/g, 'afterEvaluate { from components.release }');
  fs.writeFileSync(pluginPath, content);
  console.log('✓ Patched ExpoModulesCorePlugin.gradle — deferred components.release for AGP 8.5+');
} else {
  console.log('⚠ "from components.release" not found — patch may not be needed or file changed');
}
