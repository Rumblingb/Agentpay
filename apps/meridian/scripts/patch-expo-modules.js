#!/usr/bin/env node
/**
 * Patches ExpoModulesCorePlugin.gradle for AGP 8.5+ compatibility.
 *
 * Root cause: `from components.release` is called during project evaluation,
 * but AGP 8.5+ registers software components lazily. The fix is to defer
 * the access with an inner afterEvaluate block.
 *
 * Affects: expo-modules-core 2.x on Gradle 8.10.2 / AGP 8.6 (EAS SDK 52 image)
 */
const fs = require('fs');
const path = require('path');

const pluginPath = path.join(
  __dirname, '..', 'node_modules',
  'expo-modules-core', 'android', 'ExpoModulesCorePlugin.gradle'
);

if (!fs.existsSync(pluginPath)) {
  console.log('ExpoModulesCorePlugin.gradle not found, skipping patch');
  process.exit(0);
}

let content = fs.readFileSync(pluginPath, 'utf8');

const original = '          from components.release';
const patched  = '          afterEvaluate { from components.release }';

if (content.includes(patched)) {
  console.log('✓ ExpoModulesCorePlugin.gradle already patched');
} else if (content.includes(original)) {
  content = content.replace(original, patched);
  fs.writeFileSync(pluginPath, content);
  console.log('✓ Patched ExpoModulesCorePlugin.gradle — deferred components.release for AGP 8.5+');
} else {
  // Fallback: try with different indentation
  const alt = '        from components.release';
  const altPatched = '        afterEvaluate { from components.release }';
  if (content.includes(alt)) {
    content = content.replace(alt, altPatched);
    fs.writeFileSync(pluginPath, content);
    console.log('✓ Patched ExpoModulesCorePlugin.gradle (alt indent)');
  } else {
    console.log('⚠ Could not find "from components.release" line — patch may not be needed or file changed');
  }
}
