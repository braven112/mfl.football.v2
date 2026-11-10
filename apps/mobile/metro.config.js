// Metro, as Expo configures it, plus one folder outside the app: the repo's
// shared packages. The app bundles a few pure modules from there at runtime
// (today packages/shared-utils/src/nfl-team-colors.ts) instead of keeping its
// own copy; `@mfl/shared-utils/*` resolves through tsconfig.json's `paths`,
// which Expo's Metro honors, and Metro only reads files inside its watch
// folders. EAS builds archive the whole repository, so the folder is there.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../../packages/shared-utils/src')];

module.exports = config;
