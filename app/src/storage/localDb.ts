/**
 * The device's own database (SPEC.md §13.8, §20). expo-sqlite, opened once.
 *
 * Almost everything privacy-relevant in this app lives here rather than on the server, so
 * it is worth naming what each table is for and why the server does not have it:
 *
 * | table | what it holds | why it is not on the server |
 * |---|---|---|
 * | `signals` | who you signalled and for what | the whole point: one-sided interest is unreadable to the server (C1) |
 * | `sent_tokens` | the tokens actually uploaded each epoch, with the peer and intent they stand for | the server stores the token bytes but cannot map them back to a peer or an intent (C3) |
 * | `sightings` | drained (own EID, heard EID, windows) rows, before the nightly upload | the server never receives an EID or a window count (invariant 3) |
 * | `encounter_times` | each uploaded encounter token's coarse time block | the server never learns the time of day of a crossing (invariant 4) |
 * | `uploads` | which epochs and days have already been uploaded | enforces once-per-epoch locally, which is what makes upload volume independent of interest (C1) |
 * | `hidden_peers` | "Not for me" | a device-local preference that is never uploaded (SPEC §13.9) |
 * | `media_cache` | prefetched voice notes | so no request is ever made because a card was opened (invariant 1) |
 *
 * There is no `migrations` table: `PRAGMA user_version` is simpler and is what expo-sqlite's
 * own guidance uses. Every migration is additive, because a failed migration on a phone has
 * no DBA to fix it.
 */

import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'mutual.db';
const SCHEMA_VERSION = 1;

let handle: SQLite.SQLiteDatabase | null = null;

/** The open database, migrating it on first use. */
export async function db(): Promise<SQLite.SQLiteDatabase> {
  if (handle) return handle;
  handle = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await migrate(handle);
  return handle;
}

/** For tests: forget the handle so the next `db()` reopens (and re-migrates). */
export function resetDatabaseHandle(): void {
  handle = null;
}

async function migrate(database: SQLite.SQLiteDatabase): Promise<void> {
  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  if (current < 1) {
    await database.execAsync(`
      PRAGMA journal_mode = WAL;

      -- An active signal. One row per (peer, intent): SPEC §6.10 allows several intents to
      -- the same peer, and each one is its own token and its own slot in the padded set.
      -- peer_name and peer_identity_pk are copied from the digest at the moment the signal
      -- is made, so the Signals tab can show a name and an avatar with no network request:
      -- a per-peer fetch would be attention-dependent traffic (invariant 1), and no
      -- per-peer endpoint exists before a match anyway (invariant 10).
      CREATE TABLE IF NOT EXISTS signals (
        peer_id            TEXT NOT NULL,
        intent             TEXT NOT NULL,
        created_at         TEXT NOT NULL,
        last_crossing_day  TEXT NOT NULL,
        peer_name          TEXT NOT NULL DEFAULT '',
        peer_identity_pk   TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (peer_id, intent)
      );

      -- Tokens that were actually uploaded for an epoch, with what they stood for.
      -- Kept after a withdrawal and after a peer key change, because a match can arrive for
      -- a token uploaded before either (AC-T2-2).
      CREATE TABLE IF NOT EXISTS sent_tokens (
        epoch     TEXT NOT NULL,
        token     TEXT NOT NULL,
        peer_id   TEXT NOT NULL,
        intent    TEXT NOT NULL,
        PRIMARY KEY (epoch, token)
      );

      -- Raw drained sightings, waiting for the nightly upload. Deleted after it.
      CREATE TABLE IF NOT EXISTS sightings (
        day       TEXT NOT NULL,
        interval  INTEGER NOT NULL,
        own_eid   TEXT NOT NULL,
        heard_eid TEXT NOT NULL,
        windows   INTEGER NOT NULL,
        PRIMARY KEY (day, interval, own_eid, heard_eid)
      );

      -- token to coarse time block, for the chip on a crossing card (SPEC 6.13).
      CREATE TABLE IF NOT EXISTS encounter_times (
        token TEXT PRIMARY KEY NOT NULL,
        day   TEXT NOT NULL,
        block TEXT NOT NULL
      );

      -- Once-per-epoch bookkeeping. kind is 'signals' or 'presence'.
      CREATE TABLE IF NOT EXISTS uploads (
        kind        TEXT NOT NULL,
        period      TEXT NOT NULL,
        uploaded_at TEXT NOT NULL,
        PRIMARY KEY (kind, period)
      );

      -- "Not for me": device-local, never uploaded (SPEC §13.9, invariant 1).
      CREATE TABLE IF NOT EXISTS hidden_peers (
        peer_id    TEXT PRIMARY KEY NOT NULL,
        hidden_at  TEXT NOT NULL
      );

      -- Prefetched digest media.
      CREATE TABLE IF NOT EXISTS media_cache (
        media_id   TEXT PRIMARY KEY NOT NULL,
        path       TEXT NOT NULL,
        sha256     TEXT NOT NULL,
        bytes      INTEGER NOT NULL,
        fetched_at TEXT NOT NULL
      );

      -- Daily keys, two days ahead (SPEC 6.8). Deleted once their day is uploaded.
      CREATE TABLE IF NOT EXISTS daily_keys (
        day TEXT PRIMARY KEY NOT NULL,
        key TEXT NOT NULL
      );

      -- The minute-of-day drawn for an epoch's signal upload (SPEC 6.11).
      -- Persisted, not held in memory: a restart that re-drew the minute would bias the
      -- effective distribution earlier (the minimum of several uniform draws), and would
      -- make the upload time correlate with how often the user opens the app -- which is
      -- the kind of correlation the random draw exists to remove.
      CREATE TABLE IF NOT EXISTS epoch_plans (
        epoch  TEXT PRIMARY KEY NOT NULL,
        minute INTEGER NOT NULL
      );

      -- Which reveals this device has already played, so the Mutuals tab knows what is
      -- still "new this morning". Device-local UI state with no privacy weight: the server
      -- already knows the match exists and whether it is revealed.
      CREATE TABLE IF NOT EXISTS seen_reveals (
        match_id TEXT PRIMARY KEY NOT NULL,
        seen_at  TEXT NOT NULL
      );
    `);
  }

  await database.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/** Deletes everything. Used on logout and account deletion. */
export async function wipeLocalDatabase(): Promise<void> {
  const database = await db();
  await database.execAsync(`
    DELETE FROM signals;
    DELETE FROM sent_tokens;
    DELETE FROM sightings;
    DELETE FROM encounter_times;
    DELETE FROM uploads;
    DELETE FROM hidden_peers;
    DELETE FROM media_cache;
    DELETE FROM daily_keys;
    DELETE FROM seen_reveals;
    DELETE FROM epoch_plans;
  `);
}

// ------------------------------------------------------------- upload ledger

/** True when `kind` has already been uploaded for `period` (an epoch or a day). */
export async function hasUploaded(kind: 'signals' | 'presence', period: string): Promise<boolean> {
  const database = await db();
  const row = await database.getFirstAsync<{ one: number }>(
    'SELECT 1 AS one FROM uploads WHERE kind = ? AND period = ?',
    [kind, period],
  );
  return row !== null;
}

/**
 * Records an upload. Returns false if one was already recorded, which is how
 * once-per-epoch is enforced even if two code paths try at once (SPEC §6.11).
 */
export async function recordUpload(
  kind: 'signals' | 'presence',
  period: string,
  at: string,
): Promise<boolean> {
  const database = await db();
  const result = await database.runAsync(
    'INSERT OR IGNORE INTO uploads (kind, period, uploaded_at) VALUES (?, ?, ?)',
    [kind, period, at],
  );
  return result.changes > 0;
}

// -------------------------------------------------------------- hidden peers

export async function hidePeer(peerId: string, at: string): Promise<void> {
  const database = await db();
  await database.runAsync(
    'INSERT OR REPLACE INTO hidden_peers (peer_id, hidden_at) VALUES (?, ?)',
    [peerId, at],
  );
}

export async function unhidePeer(peerId: string): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM hidden_peers WHERE peer_id = ?', [peerId]);
}

export async function hiddenPeerIds(): Promise<string[]> {
  const database = await db();
  const rows = await database.getAllAsync<{ peer_id: string }>(
    'SELECT peer_id FROM hidden_peers',
  );
  return rows.map((r) => r.peer_id);
}

// ---------------------------------------------------------------- epoch plans

/**
 * The minute-of-day this epoch's signal upload is due, drawing one if none exists yet.
 *
 * `draw` is only called when there is no stored plan, so the minute for an epoch is drawn
 * exactly once however many times the app restarts (SPEC 6.11).
 */
export async function plannedMinuteFor(
  epoch: string,
  draw: () => number,
): Promise<number> {
  const database = await db();
  const existing = await database.getFirstAsync<{ minute: number }>(
    'SELECT minute FROM epoch_plans WHERE epoch = ?',
    [epoch],
  );
  if (existing) return existing.minute;

  const minute = draw();
  // INSERT OR IGNORE, then read back: if two callers race, both end up with the same
  // minute rather than one silently overwriting the other's plan.
  await database.runAsync('INSERT OR IGNORE INTO epoch_plans (epoch, minute) VALUES (?, ?)', [
    epoch,
    minute,
  ]);
  const settled = await database.getFirstAsync<{ minute: number }>(
    'SELECT minute FROM epoch_plans WHERE epoch = ?',
    [epoch],
  );
  return settled?.minute ?? minute;
}

/** The stored plan for an epoch, without drawing one. For the dev panel's readout. */
export async function storedPlannedMinute(epoch: string): Promise<number | null> {
  const database = await db();
  const row = await database.getFirstAsync<{ minute: number }>(
    'SELECT minute FROM epoch_plans WHERE epoch = ?',
    [epoch],
  );
  return row?.minute ?? null;
}

/** Drops plans for epochs that have passed, so the table does not grow forever. */
export async function pruneEpochPlans(before: string): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM epoch_plans WHERE epoch < ?', [before]);
}

// --------------------------------------------------------------- seen reveals

/** Marks a reveal as played, so it stops appearing as "new this morning". */
export async function markRevealSeen(matchId: string, at: string): Promise<void> {
  const database = await db();
  await database.runAsync(
    'INSERT OR REPLACE INTO seen_reveals (match_id, seen_at) VALUES (?, ?)',
    [matchId, at],
  );
}

export async function seenRevealIds(): Promise<Set<string>> {
  const database = await db();
  const rows = await database.getAllAsync<{ match_id: string }>(
    'SELECT match_id FROM seen_reveals',
  );
  return new Set(rows.map((r) => r.match_id));
}

// ---------------------------------------------------------------- daily keys

export async function putDailyKey(day: string, key: string): Promise<void> {
  const database = await db();
  await database.runAsync('INSERT OR REPLACE INTO daily_keys (day, key) VALUES (?, ?)', [
    day,
    key,
  ]);
}

export async function getDailyKey(day: string): Promise<string | null> {
  const database = await db();
  const row = await database.getFirstAsync<{ key: string }>(
    'SELECT key FROM daily_keys WHERE day = ?',
    [day],
  );
  return row?.key ?? null;
}

export async function dailyKeyDays(): Promise<string[]> {
  const database = await db();
  const rows = await database.getAllAsync<{ day: string }>(
    'SELECT day FROM daily_keys ORDER BY day',
  );
  return rows.map((r) => r.day);
}

/**
 * Deletes the daily key for `day`.
 *
 * Called right after that day's presence upload (SPEC §13.8: "Daily keys are deleted after
 * upload"). Keeping them would let anyone who later took the device recompute every EID it
 * broadcast and link it to sniffed observations.
 */
export async function deleteDailyKey(day: string): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM daily_keys WHERE day = ?', [day]);
}

// ----------------------------------------------------------- encounter times

export type TimeBlock = 'morning' | 'afternoon' | 'evening' | 'night';

export async function putEncounterTime(
  token: string,
  day: string,
  block: TimeBlock,
): Promise<void> {
  const database = await db();
  await database.runAsync(
    'INSERT OR REPLACE INTO encounter_times (token, day, block) VALUES (?, ?, ?)',
    [token, day, block],
  );
}

export async function getEncounterTime(
  token: string,
): Promise<{ day: string; block: TimeBlock } | null> {
  const database = await db();
  const row = await database.getFirstAsync<{ day: string; block: string }>(
    'SELECT day, block FROM encounter_times WHERE token = ?',
    [token],
  );
  return row ? { day: row.day, block: row.block as TimeBlock } : null;
}

/** Drops time blocks older than the digest window, so the map does not grow forever. */
export async function pruneEncounterTimes(before: string): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM encounter_times WHERE day < ?', [before]);
}
