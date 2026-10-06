/**
 * Jest setup. Two jobs:
 *   1. the CSPRNG polyfill, exactly as `index.ts` does it on device, so protocol code works;
 *   2. mocks for the native modules jest cannot load (secure store, Expo constants).
 */
import 'react-native-get-random-values';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED: 'whenUnlocked',
    getItemAsync: async (k: string) => store.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => {
      store.set(k, v);
    },
    deleteItemAsync: async (k: string) => {
      store.delete(k);
    },
  };
});

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { serverBaseUrl: 'http://localhost:8000', env: 'dev' } } },
}));
