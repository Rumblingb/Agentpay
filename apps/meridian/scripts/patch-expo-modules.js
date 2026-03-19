#!/usr/bin/env node
/**
 * Two-fix patch script for AGP 8.5+ / Gradle 8.10.2 compatibility.
 *
 * Fix 1 — ExpoModulesCorePlugin.gradle:
 *   `from components.release` fails under AGP 8.5+ lazy component registration.
 *   Wrapping in afterEvaluate defers the lookup until components are registered.
 *
 * Fix 2 — Gradle wrapper:
 *   expo prebuild generates Gradle 8.6 from the RN template, but AGP requires 8.7+.
 *   Patches the local android/ wrapper to 8.10.2 if it exists.
 */
const fs = require('fs');
const path = require('path');

// ── Fix 1: ExpoModulesCorePlugin.gradle ──────────────────────────────────────

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

// `from components.release` is only for local Maven publishing, not app builds.
// AGP 8.5+ registers components lazily — this line fails at any eval depth.
// Remove it entirely.
if (!content.includes('from components.release') &&
    !content.includes('afterEvaluate { from components.release }')) {
  console.log('✓ ExpoModulesCorePlugin.gradle already patched (line removed)');
} else {
  content = content
    .replace(/\s*afterEvaluate \{ from components\.release \}\n/g, '\n')
    .replace(/\s*from components\.release\n/g, '\n');
  fs.writeFileSync(pluginPath, content);
  console.log('✓ Removed components.release line from ExpoModulesCorePlugin.gradle');
}

// ── Fix 2: Gradle wrapper version ────────────────────────────────────────────

const wrapperPath = path.resolve(__dirname, '..', 'android', 'gradle', 'wrapper', 'gradle-wrapper.properties');
if (fs.existsSync(wrapperPath)) {
  let wrapperContent = fs.readFileSync(wrapperPath, 'utf8');
  const target = 'gradle-8.10.2-all.zip';
  if (!wrapperContent.includes(target)) {
    wrapperContent = wrapperContent.replace(
      /gradle-\d+\.\d+(?:\.\d+)?-(?:all|bin)\.zip/,
      target,
    );
    fs.writeFileSync(wrapperPath, wrapperContent);
    console.log('✓ Patched gradle-wrapper.properties to 8.10.2');
  } else {
    console.log('✓ gradle-wrapper.properties already at 8.10.2');
  }
} else {
  console.log('ℹ gradle-wrapper.properties not found locally (patched by config plugin on EAS)');
}
