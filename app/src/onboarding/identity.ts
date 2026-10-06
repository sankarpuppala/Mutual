/**
 * Identity key generation and storage (SPEC.md §6.4, journey J1).
 *
 * The X25519 keypair generated here is what makes one-sided interest unreadable to the
 * server: every interest token is keyed by a pair key derived from this private key and the
 * peer's public key (SPEC §6.5). Three consequences follow, and all three are easy to get
 * wrong:
 *
 *  1. **The private key never leaves the device.** Only the public half is sent, once, at
 *     account creation.
 *  2. **It is generated with the CSPRNG**, through `@mutual/protocol`, which throws rather
 *     than falling back to a weak source (invariant 7). `Math.random()` here would make
 *     every signal in the system forgeable.
 *  3. **Losing it is unrecoverable by design.** There is no key escrow and no backup
 *     (SPEC §4 "Out of scope"). A reinstall needs a new key, which is why the server has a
 *     rate-limited `PUT /account/identity-key`, and why tokens built under an old key stop
 *     resolving -- the documented limitation in SPEC §6.10.
 *
 * Added to SPEC §20's file list in the same change that introduced it (Phase 10).
 */

import { b64urlEncode, generateIdentityKeypair, isValidPublicKey } from '@mutual/protocol';

import { getIdentity, setIdentity, type StoredIdentity } from '@/storage/secure';

/**
 * Creates a keypair and writes it to secure storage, returning the base64url public key to
 * send to the server.
 *
 * The public key is validated before being stored, even though it was just generated: the
 * server rejects a low-order or non-canonical key (SPEC §6.5), and discovering that after
 * the key is already in secure storage would leave the device in a state where it has a key
 * the server will not accept.
 */
export async function createAndStoreIdentity(): Promise<StoredIdentity> {
  const { secretKey, publicKey: pk } = generateIdentityKeypair();
  if (!isValidPublicKey(pk)) {
    // Not expected to happen -- X25519 key generation does not produce low-order points --
    // but a silent pass here would be a cryptographic failure that nothing else catches.
    throw new Error('Generated an invalid identity key. Try again.');
  }
  const identity: StoredIdentity = { sk: b64urlEncode(secretKey), pk: b64urlEncode(pk) };
  await setIdentity(identity);
  return identity;
}

/**
 * The device's identity, creating one if this is the first run.
 *
 * Idempotent on purpose: onboarding can be interrupted and resumed, and generating a second
 * keypair after the first was already registered would silently break every token the
 * device had built.
 */
export async function ensureIdentity(): Promise<StoredIdentity> {
  const existing = await getIdentity();
  if (existing) return existing;
  return createAndStoreIdentity();
}
