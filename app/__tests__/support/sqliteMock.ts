/**
 * An `expo-sqlite` stand-in for jest, backed by Node 24's built-in `node:sqlite`.
 *
 * Why a real engine rather than a hand-written fake: `src/storage/localDb.ts` and
 * `src/signals/db.ts` carry the rules that make the signal cap, the TTL anchor and the
 * once-per-epoch ledger correct, and they express those rules **in SQL** --
 * `INSERT OR IGNORE`, `ON CONFLICT ... DO UPDATE SET windows = MAX(...)`,
 * `PRAGMA user_version`. A fake that returned plausible objects would let every one of
 * those be wrong while the tests passed.
 *
 * The surface implemented is only what the app uses: `openDatabaseAsync`, `execAsync`,
 * `runAsync`, `getFirstAsync`, `getAllAsync` and `withTransactionAsync`.
 */

import { DatabaseSync } from 'node:sqlite';

type Params = readonly (string | number | null)[];

export interface FakeDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: Params): Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync<T>(sql: string, params?: Params): Promise<T | null>;
  getAllAsync<T>(sql: string, params?: Params): Promise<T[]>;
  withTransactionAsync(work: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

function wrap(raw: DatabaseSync): FakeDatabase {
  return {
    async execAsync(sql) {
      raw.exec(sql);
    },
    async runAsync(sql, params = []) {
      const result = raw.prepare(sql).run(...(params as never[]));
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    async getFirstAsync<T>(sql: string, params: Params = []) {
      return (raw.prepare(sql).get(...(params as never[])) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, params: Params = []) {
      return raw.prepare(sql).all(...(params as never[])) as T[];
    },
    async withTransactionAsync(work) {
      // Real BEGIN/COMMIT, so a throw inside the callback really rolls back -- which is
      // what the signal-cap check relies on.
      raw.exec('BEGIN');
      try {
        await work();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    async closeAsync() {
      raw.close();
    },
  };
}

const open = new Map<string, FakeDatabase>();

/** Installed by `__tests__/setup.ts` as the `expo-sqlite` module. */
export const expoSqliteMock = {
  async openDatabaseAsync(name: string): Promise<FakeDatabase> {
    const existing = open.get(name);
    if (existing) return existing;
    // In-memory, so each test file starts clean and nothing touches the disk.
    const database = wrap(new DatabaseSync(':memory:'));
    open.set(name, database);
    return database;
  },
  async deleteDatabaseAsync(name: string): Promise<void> {
    open.delete(name);
  },
};

/** Drops every open database, for a test that wants a fresh schema. */
export function resetSqliteMock(): void {
  open.clear();
}
