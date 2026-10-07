/**
 * The BLE boundary (SPEC.md §13.8, §14). `nativeBle.ts` wraps the Kotlin module;
 * `fakeBle.ts` generates synthetic sightings so every phase except 9a is fully
 * developable on an emulator.
 *
 * The interface is deliberately narrow, and the narrowness is a privacy property:
 *
 *   - **JS hands native a schedule, never a key.** Native receives `(day, interval, eid)`
 *     triples only. Daily keys and ephemeral private keys stay in TypeScript, because
 *     cryptography does not live in Kotlin (CLAUDE.md invariant 7).
 *   - **RSSI never comes out.** `drain()` returns window *counts* above the configured
 *     threshold, never the dBm values themselves (SPEC §14.4).
 *   - **Nothing here reaches the network.** `src/presence/upload.ts` turns drained
 *     sightings into encounter tokens and uploads only those (invariant 3).
 */

/** One 15-minute slot's advertisement instruction. `eid` is base64url-encoded, 32 bytes. */
export interface ScheduleEntry {
  /** Local day, `YYYY-MM-DD`. */
  day: string;
  /** EID interval index, 0..95 (SPEC §6.8). */
  interval: number;
  /** The ephemeral id to advertise during that interval, base64url. */
  eid: string;
}

/**
 * One aggregated sighting: while advertising `ownEid` during `interval` of `day`, the
 * device heard `heardEid` in `windows` scan windows at or above the RSSI threshold.
 *
 * There is no timestamp and no RSSI value, by design. The coarse time block shown on a
 * crossing card is derived from `interval` on-device and never uploaded (SPEC §6.13).
 */
export interface Sighting {
  day: string;
  interval: number;
  ownEid: string;
  heardEid: string;
  /** Scan windows in which the peer was heard above the threshold, 1..15 (SPEC §14.4). */
  windows: number;
}

/** Why discovery is not currently running. */
export type BleUnavailableReason =
  | 'permissions_missing'
  | 'bluetooth_off'
  /**
   * No BLE 5 extended advertising on this device, so Mutual cannot put its 35-byte payload
   * on air at all and takes no part in discovery (SPEC §14.2). The split-advertisement
   * fallback that used to cover this case was withdrawn: it advertised correctly and could
   * never be received, so a phone on it looked healthy and heard nobody (DECISIONS_LOG 30).
   * Saying so is the point -- a silent nothing is indistinguishable from a quiet day.
   */
  | 'unsupported_device'
  | 'schedule_exhausted';

export interface BleStatus {
  advertising: boolean;
  scanning: boolean;
  /** Set only when advertising or scanning is false for a known reason. */
  reason?: BleUnavailableReason;
  /** The last day covered by the schedule native holds, if any. */
  scheduledThrough?: string;
}

/**
 * What both the native module and the fake adapter implement. Everything is async because
 * the native side crosses the JS bridge.
 */
export interface BleAdapter {
  /** Human-readable adapter name, for the dev panel. */
  readonly name: 'native' | 'fake';

  /** True when this device can advertise and scan at all. */
  isSupported(): Promise<boolean>;

  /**
   * Requests the Bluetooth permissions. Never requests a location permission, and must
   * reject rather than fall back if one is somehow required (CLAUDE.md invariant 3).
   */
  requestPermissions(): Promise<boolean>;

  /**
   * Replaces the advertisement schedule. Called with today's and tomorrow's entries
   * (SPEC §14.5); native stops advertising if it runs out rather than inventing an EID.
   */
  setSchedule(entries: readonly ScheduleEntry[]): Promise<void>;

  /** Starts the foreground service: advertise on schedule, duty-cycled filtered scanning. */
  start(): Promise<void>;

  /** Stops advertising and scanning entirely (the user paused discovery, S6). */
  stop(): Promise<void>;

  /**
   * Returns every aggregated sighting and clears them from native storage in one step.
   * Clearing is part of the contract: the raw pairs must not outlive the upload
   * (SPEC §14.4).
   */
  drain(): Promise<Sighting[]>;

  status(): Promise<BleStatus>;
}
