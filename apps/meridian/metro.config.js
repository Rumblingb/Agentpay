const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

process.env.EXPO_ROUTER_APP_ROOT = './app';

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...config.watchFolders, monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
// Resolve react + react-native from app node_modules to avoid version conflicts.
// Resolve @react-native/* scoped packages from app node_modules where react-native lives.
const rnRoot = path.resolve(projectRoot, 'node_modules', 'react-native');
const rnPackagesRoot = path.resolve(projectRoot, 'node_modules');

config.resolver.extraNodeModules = new Proxy(
  {
    react: path.resolve(monorepoRoot, 'node_modules', 'react'),
    'react-native': rnRoot,
    '@expo/metro-runtime': path.resolve(monorepoRoot, 'node_modules', '@expo', 'metro-runtime'),
  },
  {
    get: (target, name) => {
      if (name in target) return target[name];
      // Fall back: try app node_modules first, then monorepo root
      const appPath = path.resolve(rnPackagesRoot, name);
      const rootPath = path.resolve(monorepoRoot, 'node_modules', name);
      try { require.resolve(appPath); return appPath; } catch {}
      return rootPath;
    },
  },
);

module.exports = config;
