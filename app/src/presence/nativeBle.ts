/**
 * The real adapter: `modules/mutual-ble` behind the same interface as `fakeBle.ts`
 * (SPEC.md §13.8, §14). Swapping one for the other changes nothing above this file.
 *
 * Three things this wrapper is responsible for, beyond forwarding calls:
 *
 *  1. **Permissions.** It requests exactly the Bluetooth and notification permissions the
 *     native module asks for, and nothing else. If Android ever responds that BLE needs a
 *     location permission, this code reports failure rather than requesting one -- that is
 *     an escalation to the human, not a workaround (CLAUDE.md invariant 3).
 *  2. **Honesty about the layout.** It surfaces whether the device achieved extended
 *     advertising, the legacy split, or neither (decision D23, risk R12), so the Phase 9a
 *     spike records a measurement instead of an assumption.
 *  3. **Degrading cleanly.** With no native module present -- jest, a web preview, an Expo
 *     Go build -- every call is a no-op and `isSupported()` is false.
 */

import { PermissionsAndroid, Platform } from 'react-native';

import { MutualBle, type NativeAdvertiseLayout } from '../../modules/mutual-ble';
import { isDev } from '@/api/client';
import type {
  BleAdapter,
  BleStatus,
  BleUnavailableReason,
  ScheduleEntry,
  Sighting,
} from './bleAdapter';

/** Radio settings from the server's `/config` response (`ble.*` in server/config.yaml). */
export interface NativeBleConfig {
  scanWindowSeconds: number;
  scanPeriodSeconds: number;
  rssiThresholdDbm: number;
}

const DEFAULT_CONFIG: NativeBleConfig = {
  scanWindowSeconds: 8,
  scanPeriodSeconds: 60,
  rssiThresholdDbm: -80,
};

/** Permissions Mutual may never request, whatever Android suggests (invariant 3). */
const FORBIDDEN = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
];

export class NativeBle implements BleAdapter {
  readonly name = 'native' as const;

  private config: NativeBleConfig;
  /** The last layout the radio reported, for the dev panel and the spike notes. */
  private layout: NativeAdvertiseLayout = 'UNSUPPORTED';

  constructor(config: Partial<NativeBleConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Applies radio settings fetched from `GET /v1/config`. */
  configure(config: Partial<NativeBleConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Which advertisement layout the device managed (SPEC §14.2). */
  advertiseLayout(): NativeAdvertiseLayout {
    return this.layout;
  }

  async isSupported(): Promise<boolean> {
    if (Platform.OS !== 'android' || !MutualBle) return false;
    return MutualBle.isSupported();
  }

  async requestPermissions(): Promise<boolean> {
    if (!MutualBle) return false;
    const required = MutualBle.requiredPermissions();

    // A guard against a future dependency widening the list behind our back.
    const offending = required.filter((p) => FORBIDDEN.includes(p));
    if (offending.length > 0) {
      throw new Error(
        `The BLE module asked for ${offending.join(', ')}. Mutual never requests a location ` +
          'permission (CLAUDE.md invariant 3). Stop and escalate rather than granting it.',
      );
    }

    const granted = await PermissionsAndroid.requestMultiple(
      required as Parameters<typeof PermissionsAndroid.requestMultiple>[0],
    );
    return Object.values(granted).every((state) => state === 'granted');
  }

  async setSchedule(entries: readonly ScheduleEntry[]): Promise<void> {
    MutualBle?.setSchedule(entries.map((e) => ({ ...e })));
  }

  async start(): Promise<void> {
    MutualBle?.start({
      scanPeriodSeconds: this.config.scanPeriodSeconds,
      scanWindowSeconds: this.config.scanWindowSeconds,
      rssiThresholdDbm: this.config.rssiThresholdDbm,
    });
  }

  async stop(): Promise<void> {
    MutualBle?.stop();
  }

  async drain(): Promise<Sighting[]> {
    if (!MutualBle) return [];
    // The native side already cleared what it returned, so this list is the only copy.
    return MutualBle.drain().map((s) => ({
      day: s.day,
      interval: s.interval,
      ownEid: s.ownEid,
      heardEid: s.heardEid,
      windows: s.windows,
    }));
  }

  async status(): Promise<BleStatus> {
    if (!MutualBle) {
      return { advertising: false, scanning: false, reason: 'unsupported_device' };
    }
    const native = MutualBle.status();
    this.layout = native.layout;

    let reason: BleUnavailableReason | undefined;
    if (!native.bluetoothOn) reason = 'bluetooth_off';
    else if (native.scheduleSize === 0) reason = 'schedule_exhausted';
    else if (native.layout === 'UNSUPPORTED') reason = 'unsupported_device';
    else if (!MutualBle.hasPermissions()) reason = 'permissions_missing';

    return {
      advertising: native.advertising && native.layout !== 'UNSUPPORTED',
      scanning: native.scanning,
      reason,
      scheduledThrough: native.scheduledThrough ?? undefined,
    };
  }
}

/**
 * The adapter the app should use: the native one on a device that has the module, the fake
 * one on an emulator during development. Phase 11's presence scheduler takes an adapter as
 * a parameter, so a test can always pass its own.
 *
 * The fake adapter is **only** substituted in a dev build. It reports `advertising: true`
 * once started, which is what makes the emulator usable -- and which, on a real phone that
 * cannot advertise, would be a lie: the You screen would say discovery was running while
 * nothing was on air. In a release build an unsupported device gets the native adapter and
 * therefore the honest `unsupported_device` status. That matters for a pilot, where "the
 * app said it was running" is the difference between a measurement and a guess.
 */
export async function pickAdapter(
  config: Partial<NativeBleConfig> = {},
): Promise<BleAdapter> {
  const native = new NativeBle(config);
  if (await native.isSupported()) return native;
  if (!isDev()) return native;
  const { FakeBle } = await import('./fakeBle');
  return new FakeBle();
}
