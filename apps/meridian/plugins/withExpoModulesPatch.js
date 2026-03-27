const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function patchCallInvokerHeader(headerPath, label) {
  if (!headerPath || !fs.existsSync(headerPath)) {
    console.log(`[withExpoModulesPatch] INFO ${label} not found`);
    return;
  }

  let content = fs.readFileSync(headerPath, 'utf8');
  if (
    !content.includes('#if REACT_NATIVE_TARGET_VERSION >= 75') &&
    !content.includes('\n#else') &&
    !content.includes('\n#endif') &&
    !/\n\s*\/\/ __cplusplus\s*$/.test(content)
  ) {
    console.log(`[withExpoModulesPatch] OK ${label} already patched`);
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
  console.log(`[withExpoModulesPatch] OK Patched ${label} for RN 0.76+`);
}

function patchEXJavaScriptRuntime(runtimePath) {
  if (!runtimePath || !fs.existsSync(runtimePath)) {
    console.log('[withExpoModulesPatch] INFO EXJavaScriptRuntime.mm not found');
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
    console.log('[withExpoModulesPatch] OK EXJavaScriptRuntime.mm already patched');
    return;
  }

  if (!content.includes(oldBlock)) {
    console.log('[withExpoModulesPatch] INFO EXJavaScriptRuntime.mm schedule block not found');
    return;
  }

  content = content.replace(oldBlock, newBlock);
  fs.writeFileSync(runtimePath, content);
  console.log('[withExpoModulesPatch] OK Patched EXJavaScriptRuntime.mm for RN 0.76+');
}

const withExpoModulesPatchAndroid = (config) =>
  withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;

      let expoModulesCoreRoot;
      try {
        const pkgJson = require.resolve('expo-modules-core/package.json', {
          paths: [projectRoot, __dirname],
        });
        expoModulesCoreRoot = path.dirname(pkgJson);
      } catch (error) {
        console.log('[withExpoModulesPatch] expo-modules-core not found:', error.message);
        return config;
      }

      const pluginPath = path.join(expoModulesCoreRoot, 'android', 'ExpoModulesCorePlugin.gradle');
      if (fs.existsSync(pluginPath)) {
        let content = fs.readFileSync(pluginPath, 'utf8');
        if (
          !content.includes('from components.release') &&
          !content.includes('afterEvaluate { from components.release }')
        ) {
          console.log('[withExpoModulesPatch] OK ExpoModulesCorePlugin already patched');
        } else {
          content = content
            .replace(/\s*afterEvaluate \{ from components\.release \}\n/g, '\n')
            .replace(/\s*from components\.release\n/g, '\n');
          fs.writeFileSync(pluginPath, content);
          console.log('[withExpoModulesPatch] OK Removed components.release line');
        }
      }

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
          console.log('[withExpoModulesPatch] OK Gradle wrapper already at 8.10.2');
        } else {
          wrapperContent = wrapperContent.replace(
            /gradle-\d+\.\d+(?:\.\d+)?-(?:all|bin)\.zip/,
            targetVersion,
          );
          fs.writeFileSync(gradleWrapperPath, wrapperContent);
          console.log('[withExpoModulesPatch] OK Patched gradle-wrapper to 8.10.2');
        }
      } else {
        console.log('[withExpoModulesPatch] INFO gradle-wrapper.properties not found');
      }

      return config;
    },
  ]);

const withExpoModulesPatchIOS = (config) =>
  withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;

      let expoModulesCoreRoot;
      try {
        const pkgJson = require.resolve('expo-modules-core/package.json', {
          paths: [projectRoot, __dirname],
        });
        expoModulesCoreRoot = path.dirname(pkgJson);
      } catch (error) {
        console.log('[withExpoModulesPatch] expo-modules-core not found for iOS patch:', error.message);
        return config;
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

      return config;
    },
  ]);

module.exports = (config) => {
  config = withExpoModulesPatchAndroid(config);
  config = withExpoModulesPatchIOS(config);
  return config;
};
