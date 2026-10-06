/**
 * Sightings into encounter tokens (SPEC.md §6.13, §14.4).
 *
 * This is the one place where the device turns what its radio heard into something the
 * server will see, so it is where invariant 3 is enforced in practice. Three things are
 * applied here and nowhere else:
 *
 *  1. **The dwell threshold.** A sighting qualifies only at
 *     `presence.min_qualified_windows` (4) or more windows *within a single interval*.
 *     Counts are never summed across intervals -- "the best single sighting counts" -- so
 *     carrying several advertisers buys nothing.
 *  2. **The midnight rule.** Intervals 0 and 95 are dropped, which is what guarantees both
 *     devices record each other on the same local day.
 *  3. **The token itself**, keyed by the X25519 shared secret between the two ephemeral
 *     keys, so neither a sniffer that heard both ids nor the server can compute it.
 *
 * The coarse time block is computed here too, and kept **only on the device**
 * (`encounter_times`). The server receives a set of tokens with no times at all.
 */

import {
  ENCOUNTER_MAX_ENTRIES,
  b64urlDecode,
  b64urlEncode,
  encounterToken,
  isMidnightInterval,
  isValidPublicKey,
  paddedEncounterSet,
} from '@mutual/protocol';

import type { TimeBlock } from '@/storage/localDb';

import type { Sighting } from './bleAdapter';

/** Default `presence.min_qualified_windows`. The server's config is authoritative. */
export const DEFAULT_MIN_QUALIFIED_WINDOWS = 4;

/** 96 intervals of 15 minutes; 4 intervals an hour. */
const INTERVALS_PER_HOUR = 4;

/**
 * The coarse block an interval falls in, for the chip on a crossing card.
 *
 * Four blocks, as SPEC §13.6 and the prototype use them ("Yesterday · evening"). Nothing
 * finer is ever shown, and nothing at all is uploaded.
 */
export function timeBlockFor(interval: number): TimeBlock {
  const hour = Math.floor(interval / INTERVALS_PER_HOUR);
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

export interface QualifyingSighting {
  day: string;
  interval: number;
  ownEid: string;
  heardEid: string;
  windows: number;
}

/**
 * The sightings that pass the dwell threshold and the midnight rule, keeping the best single
 * interval per (own id, heard id) pair.
 *
 * Best *single* interval, not the sum: summing would let someone who passes you four times
 * briefly become a crossing, which is precisely what the threshold exists to prevent.
 */
export function qualifying(
  sightings: readonly Sighting[],
  minWindows: number = DEFAULT_MIN_QUALIFIED_WINDOWS,
): QualifyingSighting[] {
  const best = new Map<string, QualifyingSighting>();
  for (const s of sightings) {
    if (isMidnightInterval(s.interval)) continue;
    if (s.windows < minWindows) continue;
    const key = `${s.day}|${s.ownEid}|${s.heardEid}`;
    const current = best.get(key);
    if (!current || s.windows > current.windows) best.set(key, { ...s });
  }
  return [...best.values()];
}

export interface BuiltEncounter {
  /** base64url token, as uploaded. */
  token: string;
  day: string;
  block: TimeBlock;
  windows: number;
}

export interface BuildEncountersOptions {
  /** Resolves this device's ephemeral private key for one of its own intervals. */
  ownEphemeralKey: (day: string, interval: number) => Promise<Uint8Array | null>;
  minWindows?: number;
}

/**
 * Builds the real encounter tokens for a day's sightings.
 *
 * A heard id that is not a valid X25519 public key is dropped (SPEC §6.13 says so
 * explicitly): the shared secret would be degenerate, and a token built on it would be
 * worthless -- or, worse, equal for every peer that sent the same bad id.
 */
export async function buildEncounters(
  day: string,
  sightings: readonly Sighting[],
  { ownEphemeralKey, minWindows }: BuildEncountersOptions,
): Promise<BuiltEncounter[]> {
  const out: BuiltEncounter[] = [];
  const seen = new Set<string>();

  for (const s of qualifying(sightings, minWindows)) {
    if (s.day !== day) continue;
    const esk = await ownEphemeralKey(s.day, s.interval);
    if (!esk) continue; // the key for that day is gone; the day can no longer be uploaded

    let heard: Uint8Array;
    try {
      heard = b64urlDecode(s.heardEid);
    } catch {
      continue;
    }
    if (heard.length !== 32 || !isValidPublicKey(heard)) continue;

    let own: Uint8Array;
    try {
      own = b64urlDecode(s.ownEid);
    } catch {
      continue;
    }

    let token: Uint8Array;
    try {
      token = encounterToken(s.day, esk, own, heard);
    } catch {
      // encounterToken rejects an all-zero shared secret, which a crafted id can produce.
      continue;
    }

    const text = b64urlEncode(token);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ token: text, day: s.day, block: timeBlockFor(s.interval), windows: s.windows });
  }

  return out;
}

/**
 * The padded set to upload, and the real tokens whose time blocks to remember.
 *
 * When there are more real tokens than `encounter_max_entries` (1024), the ones with the
 * most windows are kept (SPEC §6.13) -- the longest co-presence is the most likely to be a
 * real crossing, and the other side is most likely to have kept it too.
 */
export function buildPresenceUpload(
  encounters: readonly BuiltEncounter[],
): { encounters: string[]; kept: BuiltEncounter[] } {
  const ranked = [...encounters].sort((a, b) => b.windows - a.windows);
  const kept = ranked.slice(0, ENCOUNTER_MAX_ENTRIES);
  const padded = paddedEncounterSet(kept.map((e) => b64urlDecode(e.token)));
  return { encounters: padded.map(b64urlEncode), kept };
}
