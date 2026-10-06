// babel-preset-expo already includes the Reanimated/worklets plugin for SDK 54+.
module.exports = function babelConfig(api) {
  api.cache(true);
  return { presets: [['babel-preset-expo', { jsxImportSource: 'react' }]] };
};
