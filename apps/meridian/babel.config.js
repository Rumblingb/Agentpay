module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      function () {
        return {
          visitor: {
            MemberExpression(path) {
              const obj = path.get('object');
              const prop = path.get('property');
              if (
                obj.isMemberExpression() &&
                obj.get('object').isIdentifier({ name: 'process' }) &&
                obj.get('property').isIdentifier({ name: 'env' }) &&
                prop.isIdentifier({ name: 'EXPO_ROUTER_APP_ROOT' })
              ) {
                path.replaceWith({ type: 'StringLiteral', value: './app' });
              }
            },
          },
        };
      },
    ],
  };
};
