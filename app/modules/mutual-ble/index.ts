/**
 * The raw native surface of `modules/mutual-ble` (SPEC.md §14).
 *
 * This file is the thinnest possible wrapper: it types what Kotlin exposes and nothing more.
 * The adapter that the rest of the app uses is `src/presence/nativeBle.ts`, which implements
 * the same `BleAdapter` interface as `fakeBle.ts` so that no screen or scheduler knows which
 * one it is talking to.
 *
 * **Everything structured crosses as a JSON string.** The Expo Modules API reifies the
 * types in each native `Function` signature to build its converters, and anything it cannot
 * reify throws at module-registration time — taking the app down on launch, before any JS
 * runs. `Map<String, Any?>` and `Record` classes both failed that way; only `Boolean`,
 * `Int` and `String` are used now. The parsing lives here so the rest of the app sees
 * ordinary typed objects. See DECISIONS_LOG 27.
 *
 * On a device without the native module -- an Expo Go build, a jest run, a web preview --
 * `requireOptionalNativeModule` returns null and `nativeBle.ts` reports the module as
 * unsupported instead of crashing.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';

/** Which advertisement layout the radio managed (SPEC §14.2, decision D23). */
export type NativeAdvertiseLayout = 'EXTENDED' | 'LEGACY_SPLIT' | 'UNSUPPORTED';

export interface NativeScheduleEntry {
  day: string;
  interval: number;
  /** base64url, 32 bytes. */
  eid: string;
}

export interface NativeSighting {
  day: string;
  interval: number;
  /** base64url, 32 bytes. */
  ownEid: string;
  /** base64url: 32 bytes under the extended layout, 24 under the legacy split. */
  heardEid: string;
  windows: number;
}

export interface NativeStatus {
  advertising: boolean;
  scanning: boolean;
  layout: NativeAdvertiseLayout;
  bluetoothOn: boolean;
  scheduledThrough: string | null;
  scheduleSize: number;
}

export interface NativeStartConfig {
  scanPeriodSeconds: number;
  scanWindowSeconds: number;
  rssiThresholdDbm: number;
}

/** What Kotlin actually exposes: primitives and JSON strings only. */
interface RawModule {
  isSupported(): boolean;
  hasPermissions(): boolean;
  requiredPermissionsJson(): string;
  setScheduleJson(json: string): number;
  start(scanPeriodSeconds: number, scanWindowSeconds: number, rssiThresholdDbm: number): void;
  stop(): void;
  drainJson(): string;
  statusJson(): string;
  peekJson(): string;
}

const raw = requireOptionalNativeModule<RawModule>('MutualBle');

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export interface MutualBleNativeModule {
  isSupported(): boolean;
  hasPermissions(): boolean;
  requiredPermissions(): string[];
  /** Returns how many entries native accepted, so a silently-dropped schedule is visible. */
  setSchedule(entries: NativeScheduleEntry[]): number;
  start(config: NativeStartConfig): void;
  stop(): void;
  drain(): NativeSighting[];
  status(): NativeStatus;
  /** Phase 9a debug screen only: reads the store without clearing it. */
  peek(): { windows: number; interval: number }[];
}

/** Null when the native module is not present in this binary. */
export const MutualBle: MutualBleNativeModule | null = raw
  ? {
      isSupported: () => raw.isSupported(),
      hasPermissions: () => raw.hasPermissions(),
      requiredPermissions: () => parse<string[]>(raw.requiredPermissionsJson(), []),
      setSchedule: (entries) => raw.setScheduleJson(JSON.stringify(entries)),
      start: (config) =>
        raw.start(config.scanPeriodSeconds, config.scanWindowSeconds, config.rssiThresholdDbm),
      stop: () => raw.stop(),
      drain: () => parse<NativeSighting[]>(raw.drainJson(), []),
      status: () =>
        parse<NativeStatus>(raw.statusJson(), {
          advertising: false,
          scanning: false,
          layout: 'UNSUPPORTED',
          bluetoothOn: false,
          scheduledThrough: null,
          scheduleSize: 0,
        }),
      peek: () => parse<{ windows: number; interval: number }[]>(raw.peekJson(), []),
    }
  : null;

export default MutualBle;
