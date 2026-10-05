/** Daily keys and one-time broadcast keys (EIDs) (SPEC.md §6.8, §6.3). */
import { blake2b } from '@noble/hashes/blake2.js';

import { DAILY_KEY_BYTES, EID_INTERVAL_MINUTES, EID_INTERVALS_PER_DAY, PERSON_EID } from './constants';
import { ProtocolError, uint16be } from './encoding';
import { publicKey } from './keys';
import { type RandomSource, defaultRandom } from './random';

const ESK_BYTES = 32; // X25519 private key size

/** A fresh random daily key DK_d (32 bytes). It never leaves the device. */
export function newDailyKey(rng: RandomSource = defaultRandom): Uint8Array {
  return rng.randomBytes(DAILY_KEY_BYTES);
}

function check(dailyKey: Uint8Array, interval: number): void {
  if (dailyKey.length !== DAILY_KEY_BYTES) throw new ProtocolError('daily key must be 32 bytes');
  if (!Number.isInteger(interval) || interval < 0 || interval >= EID_INTERVALS_PER_DAY) {
    throw new ProtocolError(`interval out of range: ${interval}`);
  }
}

/** esk(d, i) = BLAKE2b(uint16_be(i), key = DK_d, person = "mutual-eid-v0001"). */
export function ephemeralPrivateKey(dailyKey: Uint8Array, interval: number): Uint8Array {
  check(dailyKey, interval);
  return blake2b(uint16be(interval), { key: dailyKey, dkLen: ESK_BYTES, personalization: PERSON_EID });
}

/** EID(d, i): the X25519 public key of esk(d, i), 32 bytes, broadcast during interval i. */
export function eid(dailyKey: Uint8Array, interval: number): Uint8Array {
  return publicKey(ephemeralPrivateKey(dailyKey, interval));
}

/** All [interval, EID] pairs for one day, in interval order. */
export function eidSchedule(dailyKey: Uint8Array): Array<[number, Uint8Array]> {
  return Array.from({ length: EID_INTERVALS_PER_DAY }, (_, i) => [i, eid(dailyKey, i)]);
}

/** i = floor(minutes since local midnight / 15). The caller supplies local time (§6.3). */
export function intervalFor(hour: number, minute: number): number {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new ProtocolError(`invalid local time ${hour}:${minute}`);
  }
  return Math.floor((hour * 60 + minute) / EID_INTERVAL_MINUTES);
}

/** True for the first and last interval of the day, where no sightings are recorded (§6.13). */
export function isMidnightInterval(interval: number): boolean {
  if (!Number.isInteger(interval) || interval < 0 || interval >= EID_INTERVALS_PER_DAY) {
    throw new ProtocolError(`interval out of range: ${interval}`);
  }
  return interval === 0 || interval === EID_INTERVALS_PER_DAY - 1;
}
