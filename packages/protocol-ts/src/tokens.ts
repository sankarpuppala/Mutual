/** Interest tokens and the padded signal set (SPEC.md §6.6, §6.7). */
import { blake2b } from '@noble/hashes/blake2.js';

import { INTENTS, PAIR_KEY_BYTES, PERSON_INTEREST, SIGNAL_SET_SIZE, TOKEN_BYTES } from './constants';
import { ProtocolError, concatBytes, dayBytes } from './encoding';
import { type RandomSource, defaultRandom } from './random';

/** The one-byte intent code for a name or code from constants.json. */
export function intentCode(intent: string | number): number {
  if (typeof intent === 'string') {
    const code = INTENTS[intent];
    if (code === undefined) throw new ProtocolError(`unknown intent ${intent}`);
    return code;
  }
  if (!Object.values(INTENTS).includes(intent)) throw new ProtocolError(`unknown intent code ${intent}`);
  return intent;
}

/** T = BLAKE2b(epoch(10) || intent(1), key = K_AB, person = "mutual-interest1"). */
export function interestToken(pairKey: Uint8Array, epoch: string, intent: string | number): Uint8Array {
  if (pairKey.length !== PAIR_KEY_BYTES) throw new ProtocolError('pair key must be 32 bytes');
  const data = concatBytes(dayBytes(epoch), new Uint8Array([intentCode(intent)]));
  return blake2b(data, { key: pairKey, dkLen: TOKEN_BYTES, personalization: PERSON_INTEREST });
}

/** In-place Fisher–Yates shuffle driven by a CSPRNG. */
export function shuffle<T>(items: T[], rng: RandomSource = defaultRandom): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.randBelow(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
}

function hex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

/** Exactly signal_set_size tokens: the real ones plus CSPRNG dummies, shuffled. */
export function paddedSet(real: readonly Uint8Array[], rng: RandomSource = defaultRandom): Uint8Array[] {
  if (real.length > SIGNAL_SET_SIZE) throw new ProtocolError(`more than ${SIGNAL_SET_SIZE} real tokens`);
  if (real.some((t) => t.length !== TOKEN_BYTES)) throw new ProtocolError('every token must be 32 bytes');
  if (new Set(real.map(hex)).size !== real.length) throw new ProtocolError('duplicate real tokens');
  const tokens = [...real];
  while (tokens.length < SIGNAL_SET_SIZE) tokens.push(rng.randomBytes(TOKEN_BYTES));
  shuffle(tokens, rng);
  return tokens;
}

export { hex as toHex };
