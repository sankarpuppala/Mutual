/** Identity keys, key validity and the pair key (SPEC.md §6.4, §6.5). */
import { x25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';

import { PAIR_KEY_BYTES, PERSON_PAIR_KEY } from './constants';
import { ProtocolError, compareBytes, concatBytes, equalBytes, uidBytes } from './encoding';
import { randomBytes } from './random';

export const KEY_BYTES = 32; // X25519 private and public key size (RFC 7748)
const FIELD_PRIME = 2n ** 255n - 19n; // Curve25519 field prime (RFC 7748)
// Canonical u-coordinates of the Curve25519 points of order 1, 2, 4 and 8.
const LOW_ORDER_U = new Set<bigint>([
  0n,
  1n,
  325606250916557431795983626356110631294008115727848805560023387167927233504n,
  39382357235489614581723060781553021112529911719440698176882885853963445705823n,
  FIELD_PRIME - 1n,
]);

function littleEndian(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]!);
  return n;
}

/** A new X25519 key pair (32 bytes each) from the platform CSPRNG. */
export function generateIdentityKeypair(): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const secretKey = randomBytes(KEY_BYTES);
  return { secretKey, publicKey: publicKey(secretKey) };
}

/** The X25519 public key for a 32-byte private key. */
export function publicKey(secretKey: Uint8Array): Uint8Array {
  if (secretKey.length !== KEY_BYTES) throw new ProtocolError('private key must be 32 bytes');
  return x25519.getPublicKey(secretKey);
}

/**
 * SPEC.md §6.5 validity, without the server-side uniqueness rule: 32 bytes,
 * canonical (top bit clear and u < 2^255 − 19), not a low-order point.
 * noble accepts non-canonical keys, so this check must run before every exchange.
 */
export function isValidPublicKey(pk: Uint8Array): boolean {
  if (!(pk instanceof Uint8Array) || pk.length !== KEY_BYTES || (pk[31]! & 0x80) !== 0) return false;
  const u = littleEndian(pk);
  return u < FIELD_PRIME && !LOW_ORDER_U.has(u);
}

/** X25519 shared secret (32 bytes); rejects invalid keys and an all-zero result. */
export function sharedSecret(secretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  if (!isValidPublicKey(peerPublicKey)) throw new ProtocolError('invalid peer public key');
  let shared: Uint8Array;
  try {
    shared = x25519.getSharedSecret(secretKey, peerPublicKey);
  } catch {
    throw new ProtocolError('all-zero shared secret');
  }
  if (equalBytes(shared, new Uint8Array(KEY_BYTES))) throw new ProtocolError('all-zero shared secret');
  return shared;
}

/** K_AB = BLAKE2b(ss || lo_pk || hi_pk || uid(lo) || uid(hi)); keys sorted as raw bytes. */
export function pairKey(
  skSelf: Uint8Array,
  pkSelf: Uint8Array,
  uidSelf: string,
  pkPeer: Uint8Array,
  uidPeer: string,
): Uint8Array {
  if (!equalBytes(publicKey(skSelf), pkSelf)) throw new ProtocolError('pkSelf does not belong to skSelf');
  if (equalBytes(pkSelf, pkPeer)) throw new ProtocolError('identical public keys');
  const selfUid = uidBytes(uidSelf);
  const peerUid = uidBytes(uidPeer);
  if (equalBytes(selfUid, peerUid)) throw new ProtocolError('identical user ids');
  const ss = sharedSecret(skSelf, pkPeer);
  const [lo, hi] =
    compareBytes(pkSelf, pkPeer) < 0
      ? [{ pk: pkSelf, uid: selfUid }, { pk: pkPeer, uid: peerUid }]
      : [{ pk: pkPeer, uid: peerUid }, { pk: pkSelf, uid: selfUid }];
  return blake2b(concatBytes(ss, lo.pk, hi.pk, lo.uid, hi.uid), {
    dkLen: PAIR_KEY_BYTES,
    personalization: PERSON_PAIR_KEY,
  });
}
