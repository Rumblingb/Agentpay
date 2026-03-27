const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

process.env.EXPO_ROUTER_APP_ROOT = './app';

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch both the app and the monorepo root
config.watchFolders = [monorepoRoot];

// Resolve modules from app first, then monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
