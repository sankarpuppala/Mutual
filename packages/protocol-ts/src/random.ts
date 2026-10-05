/**
 * The single CSPRNG entry point (SPEC.md §6.1). Requires crypto.getRandomValues:
 * present in Node and browsers; in React Native it must be polyfilled
 * (expo-crypto or react-native-get-random-values) before any protocol code runs.
 */

/** A CSPRNG source; tests may pass a deterministic stand-in to check logic only. */
export interface RandomSource {
  randomBytes(n: number): Uint8Array;
  randBelow(exclusiveUpperBound: number): number;
}

type GetRandomValues = (array: Uint8Array) => Uint8Array;

function getRandomValues(): GetRandomValues {
  // Typed loosely on purpose: src/ has no DOM or Node types (it must run under Hermes).
  const c = (globalThis as { crypto?: { getRandomValues?: GetRandomValues } }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error(
      'crypto.getRandomValues is missing. In React Native, import a CSPRNG polyfill ' +
        '(expo-crypto or react-native-get-random-values) before @mutual/protocol.',
    );
  }
  return c.getRandomValues.bind(c);
}

/** n bytes from the platform CSPRNG. */
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const fill = getRandomValues();
  for (let o = 0; o < n; o += 65536) fill(out.subarray(o, Math.min(n, o + 65536)));
  return out;
}

const TWO_32 = 0x1_0000_0000;

/** Uniform integer in [0, bound) from the CSPRNG, by rejection sampling (no modulo bias). */
export function randBelow(bound: number): number {
  if (!Number.isInteger(bound) || bound <= 0 || bound > TWO_32) {
    throw new Error(`randBelow bound out of range: ${bound}`);
  }
  const limit = TWO_32 - (TWO_32 % bound);
  for (;;) {
    const b = randomBytes(4);
    const x = ((b[0]! << 24) >>> 0) + (b[1]! << 16) + (b[2]! << 8) + b[3]!;
    if (x < limit) return x % bound;
  }
}

export const defaultRandom: RandomSource = { randomBytes, randBelow };
