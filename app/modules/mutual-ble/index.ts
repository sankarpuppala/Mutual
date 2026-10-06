/**
 * The raw native surface of `modules/mutual-ble` (SPEC.md §14).
 *
 * This file is the thinnest possible wrapper: it types what Kotlin exposes and nothing more.
 * The adapter that the rest of the app uses is `src/presence/nativeBle.ts`, which implements
 * the same `BleAdapter` interface as `fakeBle.ts` so that no screen or scheduler knows which
 * one it is talking to.
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

export interface MutualBleNativeModule {
  isSupported(): boolean;
  hasPermissions(): boolean;
  requiredPermissions(): string[];
  setSchedule(entries: NativeScheduleEntry[]): void;
  start(config: NativeStartConfig): void;
  stop(): void;
  drain(): NativeSighting[];
  status(): NativeStatus;
  /** Phase 9a debug screen only: reads the store without clearing it. */
  peek(): { windows: number; interval: number }[];
}

/** Null when the native module is not present in this binary. */
export const MutualBle = requireOptionalNativeModule<MutualBleNativeModule>('MutualBle');

export default MutualBle;
