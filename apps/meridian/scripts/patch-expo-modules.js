#!/usr/bin/env node
/**
 * Three-fix patch script for build compatibility.
 *
 * Fix 1 — ExpoModulesCorePlugin.gradle:
 *   `from components.release` fails under AGP 8.5+ lazy component registration.
 *   Remove it entirely.
 *
 * Fix 2 — Gradle wrapper:
 *   expo prebuild generates Gradle 8.6 from the RN template, but AGP requires 8.7+.
 *   Patches the local android/ wrapper to 8.10.2 if it exists.
 *
 * Fix 3 — TestingSyncJSCallInvoker.h (iOS):
 *   expo-modules-core uses a REACT_NATIVE_TARGET_VERSION compile guard.
 *   On EAS Xcode builds the macro is not propagated, causing the abstract-class error.
 *   Patch the header to always use the RN >= 0.75 CallFunc&& signature.
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

// ── Fix 3: TestingSyncJSCallInvoker.h (iOS) ──────────────────────────────────
// expo-modules-core uses #if REACT_NATIVE_TARGET_VERSION >= 75 to choose
// the invokeAsync signature. On EAS the macro is not propagated to the
// expo-modules-core compilation unit, so Clang picks the wrong (pre-0.75)
// std::function<void()> branch, which doesn't match the pure virtual declared
// in RN 0.76's CallInvoker, making the class abstract and failing the build.
// Fix: replace the #if block so only the correct CallFunc&& branch is present.

let invokerPath;
try {
  const pkgJson2 = require.resolve('expo-modules-core/package.json');
  invokerPath = path.join(path.dirname(pkgJson2), 'common', 'cpp', 'TestingSyncJSCallInvoker.h');
} catch (e) {
  // already warned above
}

if (invokerPath && fs.existsSync(invokerPath)) {
  let hContent = fs.readFileSync(invokerPath, 'utf8');
  if (hContent.includes('#if REACT_NATIVE_TARGET_VERSION >= 75')) {
    // Remove the #if / #else / #endif and keep only the >= 75 (CallFunc&&) branch.
    hContent = hContent
      .replace('#if REACT_NATIVE_TARGET_VERSION >= 75\n', '')
      .replace(
        /\n#else\n  void invokeAsync\(std::function<void\(\)> &&func\) noexcept override \{\n    func\(\);\n  \}\n\n  void invokeSync\(std::function<void\(\)> &&func\) override \{\n    func\(\);\n  \}\n#endif/,
        '',
      );
    fs.writeFileSync(invokerPath, hContent);
    console.log('✓ Patched TestingSyncJSCallInvoker.h for RN 0.76+ (removed pre-0.75 branch)');
  } else {
    console.log('✓ TestingSyncJSCallInvoker.h already patched');
  }
} else {
  console.log('ℹ TestingSyncJSCallInvoker.h not found (skipping iOS patch)');
}
