/**
 * Daily keys and the EID schedule (SPEC.md §6.8, §14.5).
 *
 * A daily key is a 32-byte CSPRNG secret that never leaves the device. From it the device
 * derives 96 ephemeral ids, one per 15-minute interval, and the matching ephemeral private
 * keys. The ids are broadcast; the key and the private keys are not, and are never uploaded
 * (CLAUDE.md invariant 3).
 *
 * Keys are generated **two days ahead** so the advertisement schedule never runs dry while
 * the app is in the background, and each one is **deleted straight after that day's presence
 * upload** (SPEC §13.8). The deletion matters: with the key, anyone who later obtained the
 * device could recompute every id it broadcast and link sniffed observations to it.
 */

import {
  eid,
  eidSchedule,
  ephemeralPrivateKey,
  b64urlDecode,
  b64urlEncode,
  isMidnightInterval,
  newDailyKey,
} from '@mutual/protocol';

import {
  dailyKeyDays,
  deleteDailyKey,
  getDailyKey,
  putDailyKey,
} from '@/storage/localDb';

import type { ScheduleEntry } from './bleAdapter';
import { addDays } from '@/signals/ttl';

/** How far ahead keys are kept, in days beyond today (SPEC §13.8: "2 days ahead"). */
export const LOOKAHEAD_DAYS = 2;

/** Ensures a key exists for `day`, creating one from the CSPRNG if not. */
export async function ensureDailyKey(day: string): Promise<Uint8Array> {
  const existing = await getDailyKey(day);
  if (existing) return b64urlDecode(existing);
  const key = newDailyKey();
  await putDailyKey(day, b64urlEncode(key));
  return key;
}

/** Ensures keys exist for today and the next `LOOKAHEAD_DAYS` days. */
export async function ensureLookahead(today: string): Promise<string[]> {
  const days = [today, ...Array.from({ length: LOOKAHEAD_DAYS }, (_, i) => addDays(today, i + 1))];
  for (const day of days) await ensureDailyKey(day);
  return days;
}

/**
 * The advertisement schedule to hand to the BLE adapter: every interval of today and
 * tomorrow, except the midnight intervals.
 *
 * Intervals 0 and 95 are left out because nothing may be *recorded* in them (the midnight
 * rule, SPEC §6.13) -- so advertising in them would invite peers to hear an id they must
 * discard, and would make the device discoverable for 30 minutes a day for no purpose.
 */
export async function buildSchedule(today: string): Promise<ScheduleEntry[]> {
  const entries: ScheduleEntry[] = [];
  for (const day of [today, addDays(today, 1)]) {
    const stored = await getDailyKey(day);
    if (!stored) continue;
    for (const [interval, id] of eidSchedule(b64urlDecode(stored))) {
      if (isMidnightInterval(interval)) continue;
      entries.push({ day, interval, eid: b64urlEncode(id) });
    }
  }
  return entries;
}

/**
 * The ephemeral private key for one of this device's own intervals.
 *
 * Needed to turn a sighting into an encounter token: the token is keyed by
 * `X25519(own ephemeral private key, heard id)` (SPEC §6.13). Returns null when the key for
 * that day has already been deleted after upload, which is the expected state for any day
 * before yesterday.
 */
export async function ownEphemeralKey(
  day: string,
  interval: number,
): Promise<Uint8Array | null> {
  const stored = await getDailyKey(day);
  if (!stored) return null;
  return ephemeralPrivateKey(b64urlDecode(stored), interval);
}

/** This device's own id for an interval, used to drop its own echoes. */
export async function ownEid(day: string, interval: number): Promise<string | null> {
  const stored = await getDailyKey(day);
  if (!stored) return null;
  return b64urlEncode(eid(b64urlDecode(stored), interval));
}

/**
 * Deletes the key for a day whose presence upload is done.
 *
 * Call this *after* the upload succeeds, never before: without the key, the sightings for
 * that day can no longer be turned into tokens, so deleting early loses the day entirely.
 */
export async function forgetDay(day: string): Promise<void> {
  await deleteDailyKey(day);
}

/**
 * Deletes any key older than `keepFrom`, as a safety net.
 *
 * A key can be stranded if an upload never happened -- the device was off for two days and
 * the cutoff passed. Those days can no longer be uploaded (the server rejects them), so the
 * key has no remaining use and only carries risk.
 */
export async function forgetStaleKeys(keepFrom: string): Promise<string[]> {
  const days = await dailyKeyDays();
  const stale = days.filter((day) => day < keepFrom);
  for (const day of stale) await deleteDailyKey(day);
  return stale;
}
