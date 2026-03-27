#!/usr/bin/env node
/**
 * Five-fix patch script for build compatibility.
 *
 * Fix 1 - ExpoModulesCorePlugin.gradle:
 *   `from components.release` fails under AGP 8.5+ lazy component registration.
 *   Remove it entirely.
 *
 * Fix 2 - Gradle wrapper:
 *   expo prebuild generates Gradle 8.6 from the RN template, but AGP requires 8.7+.
 *   Patch the local android/ wrapper to 8.10.2 if it exists.
 *
 * Fix 3 - TestingSyncJSCallInvoker.h (iOS):
 *   Force the RN >= 0.75 CallFunc signature when the target version macro
 *   is missing during EAS Xcode builds.
 *
 * Fix 4 - BridgelessJSCallInvoker.h (iOS/C++):
 *   Same missing-macro issue for the bridgeless call invoker implementation.
 *
 * Fix 5 - EXJavaScriptRuntime.mm (iOS):
 *   RN 0.76 expects the scheduled block to use the `CallFunc` overload taking
 *   `jsi::Runtime&`. When expo-modules-core falls back to the old branch, the
 *   build fails with "no matching member function for call to 'invokeAsync'".
 */
const fs = require('fs');
const path = require('path');

function patchCallInvokerHeader(headerPath, label) {
  if (!headerPath || !fs.existsSync(headerPath)) {
    console.log(`INFO ${label} not found (skipping iOS patch)`);
    return;
  }

  let content = fs.readFileSync(headerPath, 'utf8');
  if (
    !content.includes('#if REACT_NATIVE_TARGET_VERSION >= 75') &&
    !content.includes('\n#else') &&
    !content.includes('\n#endif') &&
    !/\n\s*\/\/ __cplusplus\s*$/.test(content)
  ) {
    console.log(`OK ${label} already patched`);
    return;
  }

  content = content
    .replace('#if REACT_NATIVE_TARGET_VERSION >= 75\n', '')
    .replace(
      /\n#else\n  void invokeAsync\(std::function<void\(\)> &&func\) noexcept override \{\n    func\(\);\n  \}\n\n  void invokeSync\(std::function<void\(\)> &&func\) override \{\n    func\(\);\n  \}\n#endif/,
      '',
    )
    .replace(
      /\n#else\n  void invokeAsync\(std::function<void\(\)> &&func\) noexcept override \{\n    runtimeExecutor_\(\[func = std::move\(func\)\]\(jsi::Runtime &runtime\) \{ func\(\); \}\);\n  \}\n\n  void invokeSync\(std::function<void\(\)> &&func\) override \{\n    throw std::runtime_error\(\"Synchronous native -> JS calls are currently not supported\\.\"\);\n  \}\n#endif/,
      '',
    )
    .replace(/\n#else\n[\s\S]*?\n#endif(?=\n\nprivate:|\n\n  ~)/g, '');

  content = content.replace(/^\s*\/\/ __cplusplus\s*$/m, '#endif // __cplusplus');

  fs.writeFileSync(headerPath, content);
  console.log(`OK Patched ${label} for RN 0.76+`);
}

function patchEXJavaScriptRuntime(runtimePath) {
  if (!runtimePath || !fs.existsSync(runtimePath)) {
    console.log('INFO EXJavaScriptRuntime.mm not found (skipping iOS patch)');
    return;
  }

  let content = fs.readFileSync(runtimePath, 'utf8');
  const oldBlock = `- (void)schedule:(nonnull JSRuntimeExecutionBlock)block priority:(int)priority
{
#if REACT_NATIVE_TARGET_VERSION >= 75
  _jsCallInvoker->invokeAsync(SchedulerPriority(priority), [block = std::move(block)](jsi::Runtime&) {
    block();
  });
#else
  _jsCallInvoker->invokeAsync(SchedulerPriority(priority), block);
#endif
}`;
  const newBlock = `- (void)schedule:(nonnull JSRuntimeExecutionBlock)block priority:(int)priority
{
  _jsCallInvoker->invokeAsync(SchedulerPriority(priority), [block = std::move(block)](jsi::Runtime&) {
    block();
  });
}`;

  if (content.includes(newBlock)) {
    console.log('OK EXJavaScriptRuntime.mm already patched');
    return;
  }

  if (!content.includes(oldBlock)) {
    console.log('INFO EXJavaScriptRuntime.mm schedule block not found (skipping iOS patch)');
    return;
  }

  content = content.replace(oldBlock, newBlock);
  fs.writeFileSync(runtimePath, content);
  console.log('OK Patched EXJavaScriptRuntime.mm for RN 0.76+');
}

let expoModulesCoreRoot;
try {
  const pkgJson = require.resolve('expo-modules-core/package.json');
  expoModulesCoreRoot = path.dirname(pkgJson);
  console.log('expo-modules-core found at:', expoModulesCoreRoot);
} catch (error) {
  console.log('expo-modules-core not found via require.resolve:', error.message);
  process.exit(0);
}

const pluginPath = path.join(expoModulesCoreRoot, 'android', 'ExpoModulesCorePlugin.gradle');
if (!fs.existsSync(pluginPath)) {
  console.log('ExpoModulesCorePlugin.gradle not found at:', pluginPath);
  process.exit(0);
}

let pluginContent = fs.readFileSync(pluginPath, 'utf8');
if (
  !pluginContent.includes('from components.release') &&
  !pluginContent.includes('afterEvaluate { from components.release }')
) {
  console.log('OK ExpoModulesCorePlugin.gradle already patched (line removed)');
} else {
  pluginContent = pluginContent
    .replace(/\s*afterEvaluate \{ from components\.release \}\n/g, '\n')
    .replace(/\s*from components\.release\n/g, '\n');
  fs.writeFileSync(pluginPath, pluginContent);
  console.log('OK Removed components.release line from ExpoModulesCorePlugin.gradle');
}

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
    console.log('OK Patched gradle-wrapper.properties to 8.10.2');
  } else {
    console.log('OK gradle-wrapper.properties already at 8.10.2');
  }
} else {
  console.log('INFO gradle-wrapper.properties not found locally (patched by config plugin on EAS)');
}

patchCallInvokerHeader(
  path.join(expoModulesCoreRoot, 'common', 'cpp', 'TestingSyncJSCallInvoker.h'),
  'TestingSyncJSCallInvoker.h',
);
patchCallInvokerHeader(
  path.join(expoModulesCoreRoot, 'common', 'cpp', 'BridgelessJSCallInvoker.h'),
  'BridgelessJSCallInvoker.h',
);
patchEXJavaScriptRuntime(
  path.join(expoModulesCoreRoot, 'ios', 'JSI', 'EXJavaScriptRuntime.mm'),
);
