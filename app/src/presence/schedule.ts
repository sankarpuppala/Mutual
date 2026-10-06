/**
 * Keeps the radio supplied and the nightly uploads happening (SPEC.md §13.8, §14.5).
 *
 * This is the only module that *coordinates*; everything it calls is a pure function or a
 * single-purpose step, so the policy can be read in one place:
 *
 *  - make sure daily keys exist two days ahead, and hand the adapter today's and
 *    tomorrow's intervals;
 *  - drain the adapter whenever the app runs;
 *  - upload yesterday's presence set inside the presence window;
 *  - upload the epoch's signal set at its randomly chosen minute.
 *
 * Nothing here is triggered by anything a user looked at (invariant 1). The signal upload in
 * particular is driven only by the clock, and `signals/scheduler.ts` holds that policy.
 */

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { getConfig, getDigest } from '@/api/endpoints';
import type { ServerConfig } from '@/api/types';
import { decide, localDay, pickUploadMinute } from '@/signals/scheduler';
import { addDays } from '@/signals/ttl';
import { uploadSignalSet } from '@/signals/upload';
import { hasUploaded, pruneEncounterTimes } from '@/storage/localDb';
import { getIdentity, getUserId } from '@/storage/secure';

import type { BleAdapter } from './bleAdapter';
import { buildSchedule, ensureLookahead, forgetStaleKeys } from './dailyKeys';
import { drainInto } from './drain';
import { pickAdapter } from './nativeBle';
import { uploadPendingPresence } from './upload';

export interface TickResult {
  sightingsDrained: number;
  scheduleEntries: number;
  presence: Awaited<ReturnType<typeof uploadPendingPresence>>;
  staleKeysForgotten: string[];
}

function intFromConfig(config: ServerConfig, key: string, fallback: number): number {
  const value = config.ble[key];
  return typeof value === 'number' ? value : fallback;
}

/**
 * One pass of presence work. Safe to call on app open, on resume, and from the background
 * task; everything it does is idempotent.
 */
export async function presenceTick(
  adapter: BleAdapter,
  config: ServerConfig,
  now: Date = new Date(),
): Promise<TickResult> {
  const today = localDay(now);

  await ensureLookahead(today);
  const entries = await buildSchedule(today);
  await adapter.setSchedule(entries);

  const drained = await drainInto(adapter);

  const presence = await uploadPendingPresence({
    today,
    minWindows: intFromConfig(config, 'min_qualified_windows', 4),
    now,
  });

  // A key for a day that can no longer be uploaded has no use and only carries risk.
  const stale = await forgetStaleKeys(addDays(today, -1));

  // Time blocks are only needed while a crossing can still appear in a digest.
  await pruneEncounterTimes(addDays(today, -(config.interest_ttl_days + 1)));

  return {
    sightingsDrained: drained,
    scheduleEntries: entries.length,
    presence,
    staleKeysForgotten: stale,
  };
}

/** Who this device is, for building tokens. Null before the account exists. */
export async function selfIdentity(): Promise<{
  userId: string;
  sk: string;
  pk: string;
} | null> {
  const [userId, identity] = await Promise.all([getUserId(), getIdentity()]);
  if (!userId || !identity) return null;
  return { userId, sk: identity.sk, pk: identity.pk };
}

/** The server's config, fetched fresh. The windows and thresholds all come from it. */
export async function fetchConfig(): Promise<ServerConfig> {
  return getConfig();
}

// ------------------------------------------------------- the background task

/**
 * The nightly work, registered as a background task (SPEC.md §6.11, §13.8).
 *
 * Android decides when a background task runs, and it will not honour "at 21:47 exactly".
 * That is fine, and in fact helps: the task wakes periodically, and on each wake the
 * scheduler decides whether this is the minute it chose for tonight's upload. The random
 * minute is the privacy property; the wake-up cadence is just how often the device gets a
 * chance to notice.
 *
 * What the task does **not** do: retry a missed epoch. Once the batch time has passed, the
 * epoch is gone (SPEC §6.9), and queueing it for tomorrow would both be rejected and reveal
 * that something was pending.
 */

export const NIGHTLY_TASK = 'mutual-nightly';

/** The minute chosen for tonight, held in memory: a restart simply chooses again. */
let plannedMinute: { epoch: string; minute: number } | null = null;

/**
 * One pass of the nightly work. Exported so the dev panel and an app-open can run it too,
 * which is what makes the "on next open before the cutoff" path in SPEC §13.8 work.
 */
export async function runNightlyWork(now: Date = new Date()): Promise<{
  presence: TickResult | null;
  signals: string;
}> {
  const self = await selfIdentity();
  if (!self) return { presence: null, signals: 'no_account' };

  const config = await fetchConfig();
  const adapter = await pickAdapter({
    scanWindowSeconds: Number(config.ble.scan_window_seconds ?? 8),
    scanPeriodSeconds: Number(config.ble.scan_period_seconds ?? 60),
    rssiThresholdDbm: Number(config.ble.rssi_threshold_dbm ?? -80),
  });

  const presence = await presenceTick(adapter, config, now);

  const window = {
    start: config.signal_upload_window.start,
    end: config.signal_upload_window.end,
    batchTime: config.match_batch_time,
  };
  const epoch = localDay(now);
  if (!plannedMinute || plannedMinute.epoch !== epoch) {
    plannedMinute = { epoch, minute: pickUploadMinute(window) };
  }

  const decision = decide({
    now,
    window,
    alreadyUploaded: await hasUploaded('signals', epoch),
    plannedMinute: plannedMinute.minute,
  });

  if (decision.action !== 'upload') {
    return { presence, signals: `${decision.action}:${decision.reason}` };
  }

  // Peers come from the digest: the pair key needs each peer's identity public key.
  const digest = await getDigest().catch(() => null);
  const peers = (digest?.peers ?? []).map((p) => ({
    peerId: p.card.peer_id,
    identityPk: p.card.identity_pk,
  }));

  const result = await uploadSignalSet({
    self,
    peers,
    epoch,
    interestTtlDays: config.interest_ttl_days,
    now,
  });
  return { presence, signals: result.status };
}

TaskManager.defineTask(NIGHTLY_TASK, async () => {
  try {
    await runNightlyWork();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    // A failure here must not crash the app or spam a log with per-user detail.
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Registers the task. The interval is a request, not a promise: Android coalesces background
 * work, so 15 minutes is the floor and the real cadence is up to the OS.
 */
export async function registerNightlyTask(): Promise<void> {
  const already = await TaskManager.isTaskRegisteredAsync(NIGHTLY_TASK);
  if (already) return;
  await BackgroundTask.registerTaskAsync(NIGHTLY_TASK, { minimumInterval: 15 });
}

export async function unregisterNightlyTask(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(NIGHTLY_TASK)) {
    await BackgroundTask.unregisterTaskAsync(NIGHTLY_TASK);
  }
}

/**
 * Tonight's chosen upload minute, for the dev panel's readout.
 *
 * Null until the first pass of the nightly work has run, because the minute is drawn then.
 * It is shown in a dev build only -- knowing it in advance would be exactly the predictable
 * schedule the random draw exists to avoid.
 */
export function plannedUploadMinute(now: Date = new Date()): number | null {
  const epoch = localDay(now);
  return plannedMinute?.epoch === epoch ? plannedMinute.minute : null;
}
