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

config.resolver.assetExts = Array.from(
  new Set([...(config.resolver.assetExts ?? []), 'glb', 'gltf']),
);

config.resolver.sourceExts = Array.from(
  new Set([...(config.resolver.sourceExts ?? []), 'mjs', 'cjs']),
);

module.exports = config;
