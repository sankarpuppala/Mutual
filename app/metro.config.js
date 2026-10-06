// Metro for an npm-workspaces monorepo (SPEC.md §13.1), following Expo's monorepo guide.
// Two things are needed: watch the repo root so @mutual/protocol and
// packages/protocol-spec/constants.json are seen, and resolve modules from both
// node_modules trees because npm hoists most packages to the root.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Keep one copy of each package: duplicate react or reanimated copies break the app.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
