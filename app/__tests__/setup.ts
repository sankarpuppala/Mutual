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

// A real SQLite engine (Node 24's node:sqlite) rather than a fake: the local database's
// rules are written in SQL, and a fake would let them all be wrong silently.
jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { expoSqliteMock } = require('./support/sqliteMock');
  return expoSqliteMock;
});

// expo-file-system's File/Directory API, over an in-memory map. Real enough that
// cache.ts's index-versus-filesystem reconciliation is still exercised.
jest.mock('expo-file-system', () => {
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>(['file:///test/document']);

  const join = (...parts: unknown[]): string =>
    parts
      .map((part) =>
        typeof part === 'string' ? part : String((part as { uri?: string }).uri ?? ''),
      )
      .filter(Boolean)
      .join('/')
      .replace(/\/+/g, '/')
      .replace('file:/', 'file:///');

  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(...parts);
    }
    get exists(): boolean {
      return directories.has(this.uri);
    }
    create(): void {
      directories.add(this.uri);
    }
  }

  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(...parts);
    }
    get exists(): boolean {
      return files.has(this.uri);
    }
    create(): void {
      files.set(this.uri, new Uint8Array());
    }
    write(content: Uint8Array): void {
      files.set(this.uri, content);
    }
    bytesSync(): Uint8Array {
      return files.get(this.uri) ?? new Uint8Array();
    }
    delete(): void {
      files.delete(this.uri);
    }
  }

  return {
    File,
    Directory,
    Paths: { document: new Directory('file:///test/document'), cache: new Directory('file:///test/cache') },
    __files: files,
  };
});
