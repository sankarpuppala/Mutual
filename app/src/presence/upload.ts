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

import { uploadPresence } from '@/api/endpoints';
import { ApiError } from '@/api/client';
import { hasUploaded, putEncounterTime, recordUpload } from '@/storage/localDb';
import { addDays } from '@/signals/ttl';

import { ownEphemeralKey, forgetDay } from './dailyKeys';
import { buildEncounters, buildPresenceUpload } from './encounters';
import { clearSightings, clearSightingsBefore, daysWithSightings, storedSightings } from './drain';

export interface PresenceUploadContext {
  /** Today's local day. Only days before it can be uploaded (SPEC §11). */
  today: string;
  /** `presence.min_qualified_windows` from the server's config. */
  minWindows: number;
  now: Date;
}

export type PresenceResult =
  | { status: 'uploaded'; day: string; real: number; sent: number }
  | { status: 'nothing_to_send'; day: string }
  | { status: 'already_uploaded'; day: string }
  | { status: 'rejected'; day: string; code: string };

/**
 * Uploads one day's set.
 *
 * With no qualifying sightings, **nothing is sent**. That is not a leak: the server already
 * learns which days a user uploaded at all, and an empty set would still be 256 padding
 * entries -- a full upload's bandwidth to say "I was alone". The padding hides *how many*
 * sightings a night had, not whether a night happened, and SPEC §7.3 says so.
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
  if (encounters.length === 0) {
    // Claim the day anyway, so the next run does not rebuild nothing again, and clean up.
    await recordUpload('presence', day, now.toISOString());
    await clearSightings(day);
    await forgetDay(day);
    return { status: 'nothing_to_send', day };
  }

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
 * The server accepts a day only before its cutoff, the start of day + 2 (SPEC §11), so at
 * most yesterday and the day before are ever in play. Anything older is cleaned up rather
 * than retried, because retrying a rejected day forever is how a background task starts
 * waking a phone for nothing.
 */
export async function uploadPendingPresence(
  context: PresenceUploadContext,
): Promise<PresenceResult[]> {
  const { today } = context;
  const cutoff = addDays(today, -1); // the oldest day the server still accepts
  const results: PresenceResult[] = [];

  for (const day of await daysWithSightings()) {
    if (day >= today) continue; // today is not finished; it is uploaded tomorrow night
    if (day < cutoff) continue; // past the server's cutoff
    results.push(await uploadPresenceFor(day, context));
  }

  await clearSightingsBefore(cutoff);
  return results;
}
