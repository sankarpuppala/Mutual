// jest-expo transforms the Expo/React Native stack; @mutual/protocol ships raw TypeScript
// from the workspace, so it must be transformed too rather than ignored as a node module.
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
  testMatch: ['<rootDir>/__tests__/**/*.test.ts', '<rootDir>/__tests__/**/*.test.tsx'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@mutual/protocol|@noble/.*))',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
};
