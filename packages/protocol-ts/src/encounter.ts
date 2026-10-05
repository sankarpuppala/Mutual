/** Secret-keyed encounter tokens and the padded presence set (SPEC.md §6.13). */
import { blake2b } from '@noble/hashes/blake2.js';

import { ENCOUNTER_BYTES, ENCOUNTER_MAX_ENTRIES, ENCOUNTER_PAD_BLOCK, PERSON_ENCOUNTER } from './constants';
import { ProtocolError, compareBytes, concatBytes, dayBytes, equalBytes } from './encoding';
import { publicKey, sharedSecret } from './keys';
import { type RandomSource, defaultRandom } from './random';
import { shuffle, toHex } from './tokens';

/**
 * E = BLAKE2b(day(10) || lo || hi, key = X25519(eskOwn, eidHeard), "mutual-encount01").
 * Both devices compute the same value; anyone without one of the two private keys cannot.
 */
export function encounterToken(day: string, eskOwn: Uint8Array, eidOwn: Uint8Array, eidHeard: Uint8Array): Uint8Array {
  if (equalBytes(eidOwn, eidHeard)) throw new ProtocolError('own and heard EID are identical');
  if (!equalBytes(publicKey(eskOwn), eidOwn)) throw new ProtocolError('eidOwn does not belong to eskOwn');
  const ss = sharedSecret(eskOwn, eidHeard); // rejects invalid or low-order EIDs and all-zero secrets
  const [lo, hi] = compareBytes(eidOwn, eidHeard) < 0 ? [eidOwn, eidHeard] : [eidHeard, eidOwn];
  return blake2b(concatBytes(dayBytes(day), lo, hi), {
    key: ss,
    dkLen: ENCOUNTER_BYTES,
    personalization: PERSON_ENCOUNTER,
  });
}

/** Smallest multiple of encounter_pad_block that holds nReal (at least one block). */
export function paddedSize(nReal: number): number {
  if (!Number.isInteger(nReal) || nReal < 0 || nReal > ENCOUNTER_MAX_ENTRIES) {
    throw new ProtocolError(`real encounter count out of range: ${nReal}`);
  }
  return Math.max(1, Math.ceil(nReal / ENCOUNTER_PAD_BLOCK)) * ENCOUNTER_PAD_BLOCK;
}

/**
 * Real tokens plus CSPRNG dummies, padded to a multiple of 256 and shuffled.
 * The device chooses which real tokens to keep above encounter_max_entries; this raises instead.
 */
export function paddedEncounterSet(real: readonly Uint8Array[], rng: RandomSource = defaultRandom): Uint8Array[] {
  if (real.some((t) => t.length !== ENCOUNTER_BYTES)) throw new ProtocolError('every encounter token must be 32 bytes');
  if (new Set(real.map(toHex)).size !== real.length) throw new ProtocolError('duplicate encounter tokens');
  const size = paddedSize(real.length);
  const entries = [...real];
  while (entries.length < size) entries.push(rng.randomBytes(ENCOUNTER_BYTES));
  shuffle(entries, rng);
  return entries;
}
