/**
 * Draining sightings out of the adapter and into the local database (SPEC.md §14.4).
 *
 * `BleAdapter.drain()` clears what it returns, so whatever this function receives is the
 * only copy. It is written to `sightings` immediately -- before any token is built -- so a
 * crash between drain and upload loses nothing. Rows are deleted only once the day they
 * belong to has been uploaded.
 */

import { db } from '@/storage/localDb';

import type { BleAdapter, Sighting } from './bleAdapter';

/**
 * Drains the adapter and stores the result.
 *
 * Window counts are merged with `MAX`, not added: if a drain happens mid-interval and the
 * same pair is seen again afterwards, the right answer is the highest count in that single
 * interval, not the sum (SPEC §6.13's "best single sighting").
 */
export async function drainInto(adapter: BleAdapter): Promise<number> {
  const sightings = await adapter.drain();
  if (sightings.length === 0) return 0;

  const database = await db();
  await database.withTransactionAsync(async () => {
    for (const s of sightings) {
      await database.runAsync(
        `INSERT INTO sightings (day, interval, own_eid, heard_eid, windows)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(day, interval, own_eid, heard_eid)
         DO UPDATE SET windows = MAX(windows, excluded.windows)`,
        [s.day, s.interval, s.ownEid, s.heardEid, s.windows],
      );
    }
  });
  return sightings.length;
}

/** Every stored sighting for a day. */
export async function storedSightings(day: string): Promise<Sighting[]> {
  const database = await db();
  const rows = await database.getAllAsync<{
    day: string;
    interval: number;
    own_eid: string;
    heard_eid: string;
    windows: number;
  }>(
    `SELECT day, interval, own_eid, heard_eid, windows FROM sightings
      WHERE day = ? ORDER BY interval`,
    [day],
  );
  return rows.map((r) => ({
    day: r.day,
    interval: r.interval,
    ownEid: r.own_eid,
    heardEid: r.heard_eid,
    windows: r.windows,
  }));
}

/** The days that have stored sightings, oldest first. */
export async function daysWithSightings(): Promise<string[]> {
  const database = await db();
  const rows = await database.getAllAsync<{ day: string }>(
    'SELECT DISTINCT day FROM sightings ORDER BY day',
  );
  return rows.map((r) => r.day);
}

/**
 * Deletes a day's raw sightings.
 *
 * Called after that day's upload. The raw pairs are more sensitive than the tokens built
 * from them -- they carry the device's own ids alongside the peers' -- so they do not
 * outlive their purpose (SPEC §14.4).
 */
export async function clearSightings(day: string): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM sightings WHERE day = ?', [day]);
}

/** Drops sightings for days that can no longer be uploaded (past the server's cutoff). */
export async function clearSightingsBefore(day: string): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM sightings WHERE day < ?', [day]);
}
