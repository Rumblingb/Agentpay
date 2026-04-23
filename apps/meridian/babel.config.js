const path = require('path');

// expo-router is hoisted to the monorepo root node_modules.
// require.context resolves paths relative to the file that calls it,
// which is node_modules/expo-router/_ctx.android.js.
// So we need the path from expo-router's directory to our app folder.
const expoRouterDir = path.dirname(
  require.resolve('expo-router/package.json', { paths: [__dirname] }),
);
const appDir     = path.resolve(__dirname, 'app');
const appRelPath = path.relative(expoRouterDir, appDir).replace(/\\/g, '/');

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      function () {
        const INLINE_ENV = {
          EXPO_ROUTER_APP_ROOT:    appRelPath,
          EXPO_ROUTER_IMPORT_MODE: 'sync',
        };
        return {
          visitor: {
            MemberExpression(nodePath) {
              const obj  = nodePath.get('object');
              const prop = nodePath.get('property');
              if (
                obj.isMemberExpression() &&
                obj.get('object').isIdentifier({ name: 'process' }) &&
                obj.get('property').isIdentifier({ name: 'env' }) &&
                prop.isIdentifier()
              ) {
                const name = prop.node.name;
                if (name in INLINE_ENV) {
                  nodePath.replaceWith({ type: 'StringLiteral', value: INLINE_ENV[name] });
                }
              }
            },
          },
        };
      },
      'react-native-reanimated/plugin',
    ],
  };
};
