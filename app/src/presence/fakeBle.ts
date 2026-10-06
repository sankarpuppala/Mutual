/**
 * The fake BLE adapter (PLAN.md Phase 8 task 9): synthetic sightings, so the whole app --
 * presence, digest, signals, matches -- is developable and testable on an emulator with no
 * Bluetooth hardware and no second phone.
 *
 * It is deterministic when given a seed, so a jest test can assert exact sightings. It is
 * also honest about the shape of real data: it respects the midnight rule (no intervals 0
 * or 95, SPEC §6.13), produces window counts in 1..15, and can be told to produce some
 * sightings below the dwell threshold so the qualifying logic is actually exercised.
 *
 * It is NOT a simulation of radio behaviour. Detection rates, range and battery cost are
 * measured on real phones in Phase 9a (`docs/BLE_SPIKE.md`), never guessed here.
 */

import { b64urlEncode } from '@mutual/protocol';

import type {
  BleAdapter,
  BleStatus,
  ScheduleEntry,
  Sighting,
} from './bleAdapter';

/** Intervals 0 and 95 are excluded by the midnight rule (SPEC §6.13). */
const FIRST_INTERVAL = 1;
const LAST_INTERVAL = 94;
const MAX_WINDOWS = 15;

export interface FakeBleOptions {
  /** Deterministic stream seed. The same seed always yields the same sightings. */
  seed?: number;
  /** Synthetic peers to be "heard". Each contributes 0..2 sightings per generation. */
  peers?: number;
  /**
   * How many of the generated sightings fall below `presence.min_qualified_windows`.
   * Default 0.25: a quarter are brief brush-pasts that must not become crossings.
   */
  brushPastShare?: number;
}

/** A small deterministic PRNG. Not security-relevant: never used for protocol bytes. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 32-byte value that looks like an EID, derived from the PRNG (never a real key). */
function fakeEid(rand: () => number): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(rand() * 256);
  return b64urlEncode(bytes);
}

export class FakeBle implements BleAdapter {
  readonly name = 'fake' as const;

  private readonly rand: () => number;
  private readonly peers: number;
  private readonly brushPastShare: number;
  private schedule: readonly ScheduleEntry[] = [];
  private running = false;
  private pending: Sighting[] = [];
  /** Stable synthetic peer EIDs, so the same peer recurs across days like a real one. */
  private readonly peerEids: string[];

  constructor(options: FakeBleOptions = {}) {
    this.rand = mulberry32(options.seed ?? 1);
    this.peers = options.peers ?? 6;
    this.brushPastShare = options.brushPastShare ?? 0.25;
    this.peerEids = Array.from({ length: this.peers }, () => fakeEid(this.rand));
  }

  async isSupported(): Promise<boolean> {
    return true;
  }

  async requestPermissions(): Promise<boolean> {
    return true;
  }

  async setSchedule(entries: readonly ScheduleEntry[]): Promise<void> {
    this.schedule = entries;
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async drain(): Promise<Sighting[]> {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  async status(): Promise<BleStatus> {
    const last = this.schedule.at(-1);
    return {
      advertising: this.running && this.schedule.length > 0,
      scanning: this.running,
      reason: this.schedule.length === 0 ? 'schedule_exhausted' : undefined,
      scheduledThrough: last?.day,
    };
  }

  /**
   * Generates a day's worth of synthetic sightings, as if the device had been carried
   * around. Call it from the dev panel or a test; the real adapter fills `pending` from
   * the foreground service instead.
   *
   * Sightings use the device's own scheduled EID for the interval, so the pair
   * (own EID, heard EID) is consistent with what `encounters.ts` expects.
   */
  generateDay(day: string, options: { peers?: number } = {}): Sighting[] {
    const slots = this.schedule.filter((e) => e.day === day);
    if (slots.length === 0) return [];
    const count = Math.min(options.peers ?? this.peers, this.peerEids.length);
    const produced: Sighting[] = [];

    for (let p = 0; p < count; p++) {
      const heardEid = this.peerEids[p]!;
      const slot = slots[Math.floor(this.rand() * slots.length)]!;
      if (slot.interval < FIRST_INTERVAL || slot.interval > LAST_INTERVAL) continue;
      const brushPast = this.rand() < this.brushPastShare;
      // A brush-past lands in 1..3 windows (below the default threshold of 4); a real
      // co-presence lands in 4..15.
      const windows = brushPast
        ? 1 + Math.floor(this.rand() * 3)
        : 4 + Math.floor(this.rand() * (MAX_WINDOWS - 3));
      produced.push({
        day,
        interval: slot.interval,
        ownEid: slot.eid,
        heardEid,
        windows,
      });
    }

    this.pending.push(...produced);
    return produced;
  }
}
