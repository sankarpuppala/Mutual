/**
 * The nightly presence upload (SPEC.md §6.13, §11, §13.8).
 *
 * The sequence, and why it is in this order:
 *
 *  1. claim the day in the local ledger, so two callers cannot both upload;
 *  2. build the tokens from the stored sightings, while the daily key still exists;
 *  3. remember each real token's coarse time block **on the device**, for the card's chip;
 *  4. upload the padded set;
 *  5. only then delete the raw sightings and the daily key.
 *
 * Steps 4 and 5 are deliberately not swapped. Deleting first would mean a failed request
 * loses the night with no way to rebuild it; deleting after means a crash leaves data that
 * the next run cleans up. The padding means the server sees the same thing either way.
 */

import { randBelow } from '@mutual/protocol';

import { uploadPresence } from '@/api/endpoints';
import { ApiError } from '@/api/client';
import { deviceClock, type DeploymentClock } from '@/signals/deploymentClock';
import { minutesOfDay } from '@/signals/scheduler';
import { addDays } from '@/signals/ttl';
import {
  hasUploaded,
  plannedPresenceMinuteFor,
  putEncounterTime,
  recordUpload,
} from '@/storage/localDb';

import { ownEphemeralKey, forgetDay } from './dailyKeys';
import { buildEncounters, buildPresenceUpload } from './encounters';
import { clearSightings, clearSightingsBefore, daysWithSightings, storedSightings } from './drain';

export interface PresenceUploadContext {
  /** Today's local day. Only days before it can be uploaded (SPEC §11). */
  today: string;
  /** `presence.min_qualified_windows` from the server's config. */
  minWindows: number;
  now: Date;
  /**
   * `presence_upload_window` from `GET /v1/config`. When given, the upload waits for the
   * minute drawn inside it (SPEC §6.11). Omitted in tests that are about the set's
   * contents rather than its timing.
   */
  window?: { start: string; end: string };
  /** The deployment's wall clock, for reading the window. Defaults to the device's. */
  clock?: DeploymentClock;
}

export type PresenceResult =
  | { status: 'uploaded'; day: string; real: number; sent: number }
  | {
      status: 'waiting';
      day: string;
      /** The minute inside the window this night's upload was drawn for. */
      dueMinute: number;
      /**
       * `window_closed` is not the same as "not yet": the day is now lost, because the
       * server's cutoff will refuse it tomorrow. Named separately so a dev-panel readout
       * or a spike note can tell a wait from a loss.
       */
      reason: 'before_due_minute' | 'window_closed';
    }
  | { status: 'already_uploaded'; day: string }
  | { status: 'rejected'; day: string; code: string };

/**
 * Uploads one day's set.
 *
 * **A night with no qualifying sightings is uploaded too**, as 256 dummy tokens.
 *
 * This file used to skip it, on the argument that the padding hides how many sightings a
 * night had rather than whether a night happened. That argument does not survive being
 * written down next to SPEC §6.13, which says the set is padded "to the next multiple of
 * 256, **at least 256**" -- an empty set pads to 256 and is sent. §7.3 grants the server
 * only "the size rounded up to a multiple of 256"; silence is not a size. With the skip in
 * place, zero was the one count the server could read exactly, so it learned precisely
 * which nights a user was near nobody: ill, off campus, or alone. That is a sensitive
 * pattern about a named account, and it was the cheapest thing in the system to observe.
 *
 * The cost is one 23 KB request on a night that had nothing in it, which is the price the
 * padding rule was already paying for every other count.
 */
export async function uploadPresenceFor(
  day: string,
  { minWindows, now }: Omit<PresenceUploadContext, 'today'>,
): Promise<PresenceResult> {
  if (await hasUploaded('presence', day)) return { status: 'already_uploaded', day };

  const sightings = await storedSightings(day);
  const encounters = await buildEncounters(day, sightings, {
    ownEphemeralKey,
    minWindows,
  });
  if (!(await recordUpload('presence', day, now.toISOString()))) {
    return { status: 'already_uploaded', day };
  }

  const { encounters: padded, kept } = buildPresenceUpload(encounters);

  // The time blocks are the device's own record, and the only place a crossing's time of day
  // exists anywhere (invariant 4). Written before the upload so a crash cannot lose them
  // while the server keeps the token.
  for (const e of kept) await putEncounterTime(e.token, e.day, e.block);

  try {
    await uploadPresence(day, { encounters: padded });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 409) {
        await clearSightings(day);
        await forgetDay(day);
        return { status: 'already_uploaded', day };
      }
      return { status: 'rejected', day, code: error.code };
    }
    throw error;
  }

  await clearSightings(day);
  await forgetDay(day);
  return { status: 'uploaded', day, real: kept.length, sent: padded.length };
}

/**
 * Uploads every day that still can be.
 *
 * The server accepts a day only before its cutoff, the start of day + 2 (SPEC §11), so
 * yesterday is the oldest day still worth sending. Anything older is cleaned up rather than
 * retried, because retrying a rejected day forever is how a background task starts waking a
 * phone for nothing.
 */
export async function uploadPendingPresence(
  context: PresenceUploadContext,
): Promise<PresenceResult[]> {
  const { today, now, window, clock = deviceClock } = context;
  const cutoff = addDays(today, -1); // the oldest day the server still accepts
  const results: PresenceResult[] = [];

  // Independent of the window, and done first so that a device which never catches its
  // upload window still clears away sightings the server would no longer accept. Raw
  // sightings are the one thing on the device that could rebuild a movement trace, so
  // letting them accumulate because of a timing rule would be the wrong way round.
  await clearSightingsBefore(cutoff);

  // SPEC §6.11: the upload goes out "at a random time between 00:05 and 06:00 local on day
  // d+1", and the section says in so many words that this is a privacy property rather
  // than a convenience. Without it the upload lands whenever Android happens to wake the
  // background task, and when Android wakes a phone correlates with when its owner is
  // using it -- so the server would get a nightly, per-account signal about sleep and
  // routine for free. The minute is drawn once per night from the CSPRNG and persisted,
  // the same way the signal upload's is.
  if (window) {
    const first = minutesOfDay(window.start);
    const last = minutesOfDay(window.end) - 1;
    if (last < first) {
      throw new Error('The presence upload window is empty; check presence.* in server config.');
    }
    const dueMinute = await plannedPresenceMinuteFor(
      today,
      () => first + randBelow(last - first + 1),
    );
    const minuteNow = clock.minutes(now);
    if (minuteNow < dueMinute || minuteNow > last) {
      const reason = minuteNow > last ? ('window_closed' as const) : ('before_due_minute' as const);
      for (const day of await daysWithSightings()) {
        if (day >= today || day < cutoff) continue;
        results.push({ status: 'waiting', day, dueMinute, reason });
      }
      return results;
    }
  }

  for (const day of await daysWithSightings()) {
    if (day >= today) continue; // today is not finished; it is uploaded tomorrow night
    if (day < cutoff) continue; // past the server's cutoff
    results.push(await uploadPresenceFor(day, context));
  }

  return results;
}
