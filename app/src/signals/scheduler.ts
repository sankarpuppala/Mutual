/**
 * When the epoch's signal set goes out (SPEC.md §6.11) -- the timing half of claim C1.
 *
 * The rules, all four of which are load-bearing:
 *
 *  1. **Once per epoch.** Never twice, however many times the app is opened.
 *  2. **At a random time inside the window**, drawn from the CSPRNG, so the upload time
 *     carries no information about when the user acted.
 *  3. **Never before the window opens** and **never at or after `match_batch_time`**: the
 *     server rejects both (425 and 400), and an upload at 23:44:59 would be a timing
 *     signal of its own.
 *  4. **Never for a past epoch.** The server only accepts today's, and retrying yesterday's
 *     would reveal that something was pending.
 *
 * Everything here is a pure function of (now, window, ledger), so the whole policy is
 * testable without a clock, a server or a background task. `upload.ts` is what acts on it.
 */

import { randBelow } from '@mutual/protocol';

export interface UploadWindow {
  /** `HH:MM`, inclusive. */
  start: string;
  /** `HH:MM`, exclusive. */
  end: string;
  /** `HH:MM`: the nightly batch. An upload at or after this is rejected (SPEC §6.9). */
  batchTime: string;
}

/** Minutes since local midnight for an `HH:MM` string. */
export function minutesOfDay(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Minutes since local midnight for a Date, in the device's local timezone. */
export function nowMinutes(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** The local day of a Date as `YYYY-MM-DD`, which is what an epoch is. */
export function localDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The last minute at which an upload is still allowed: the window's end, or the batch time
 * if that comes first.
 */
export function lastAllowedMinute(window: UploadWindow): number {
  return Math.min(minutesOfDay(window.end), minutesOfDay(window.batchTime)) - 1;
}

/**
 * Picks the minute-of-day at which this epoch's upload should happen.
 *
 * Uniform over the allowed range, from the CSPRNG (never `Math.random()`: the upload time
 * is a privacy parameter, and a predictable schedule would let an observer tell a missing
 * upload from a late one).
 */
export function pickUploadMinute(window: UploadWindow): number {
  const first = minutesOfDay(window.start);
  const last = lastAllowedMinute(window);
  if (last < first) {
    throw new Error('The signal upload window is empty; check signals.* in server config.');
  }
  return first + randBelow(last - first + 1);
}

export type SkipReason =
  | 'already_uploaded'
  | 'before_window'
  | 'after_batch_time'
  | 'not_yet_due';

export type Decision =
  | { action: 'upload'; epoch: string }
  | { action: 'wait'; reason: SkipReason; dueMinute?: number }
  | { action: 'skip'; reason: SkipReason };

export interface DecideOptions {
  now: Date;
  window: UploadWindow;
  /** True when this epoch's set has already gone out. */
  alreadyUploaded: boolean;
  /** The minute chosen for today, if one has been chosen. */
  plannedMinute: number | null;
}

/**
 * What to do right now.
 *
 * `wait` means "not yet, come back later"; `skip` means "not at all today". The difference
 * matters: a caller must not treat a closed window as a failure to retry, because retrying
 * past the batch time is exactly the behaviour the server rejects.
 */
export function decide({
  now,
  window,
  alreadyUploaded,
  plannedMinute,
}: DecideOptions): Decision {
  const epoch = localDay(now);
  if (alreadyUploaded) return { action: 'skip', reason: 'already_uploaded' };

  const minute = nowMinutes(now);
  if (minute < minutesOfDay(window.start)) {
    return { action: 'wait', reason: 'before_window' };
  }
  if (minute > lastAllowedMinute(window)) {
    // Past the batch: today's epoch is gone. Nothing is retried and nothing is queued --
    // a queued upload would arrive tomorrow carrying a token for a past epoch, which the
    // server rejects and which would itself be a signal that something was pending.
    return { action: 'skip', reason: 'after_batch_time' };
  }
  if (plannedMinute !== null && minute < plannedMinute) {
    return { action: 'wait', reason: 'not_yet_due', dueMinute: plannedMinute };
  }
  return { action: 'upload', epoch };
}

/**
 * How long to wait before checking again, in milliseconds.
 *
 * Deliberately coarse (a minute at a time): a tighter poll would wake the device more often
 * for no benefit, and the upload only has to land somewhere inside a 5.5-hour window.
 */
export function nextCheckDelayMs(decision: Decision): number {
  if (decision.action === 'skip') return 60 * 60 * 1000;
  if (decision.action === 'upload') return 0;
  return 60 * 1000;
}
