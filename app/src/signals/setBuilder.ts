/**
 * Builds the epoch's padded signal set (SPEC.md §6.7, §6.11) through `@mutual/protocol`.
 *
 * Every byte that leaves the device is produced here, and the properties that make claim C1
 * true are all properties of this function:
 *
 *  - **exactly 20 entries**, whether there are 0 real signals or 20;
 *  - **the padding is CSPRNG output**, indistinguishable from a real token to anyone without
 *    one of the two private keys;
 *  - **the order is a CSPRNG shuffle**, so position says nothing;
 *  - **the real tokens are returned separately**, so the device can record what each one
 *    stood for (`sent_tokens`) without that mapping ever being derivable from the upload.
 *
 * None of the padding or shuffling is implemented here: `paddedSet` in protocol-ts does it,
 * byte-identically to `protocol_py`, under the committed vector suite. This file's job is
 * to turn stored signals into pair keys and interest tokens, in a defined order.
 */

import {
  SIGNAL_SET_SIZE,
  b64urlDecode,
  b64urlEncode,
  interestToken,
  isValidPublicKey,
  pairKey,
  paddedSet,
} from '@mutual/protocol';

import type { Intent } from '@/api/types';

import type { StoredSignal } from './db';

export interface PeerKey {
  peerId: string;
  /** The peer's identity public key as the digest gave it, base64url. */
  identityPk: string;
}

export interface BuiltSet {
  /** Exactly `SIGNAL_SET_SIZE` base64url tokens, shuffled, ready to upload. */
  tokens: string[];
  /** What each real token stood for, for `sent_tokens`. Never uploaded. */
  real: { token: string; peerId: string; intent: Intent }[];
  /** Signals that could not be built, with the reason. Reported, never silently dropped. */
  skipped: { peerId: string; intent: Intent; reason: 'unknown_peer' | 'invalid_key' }[];
}

export interface BuildOptions {
  /** The device's own identity, base64url. */
  self: { userId: string; sk: string; pk: string };
  /** The epoch the set is for, `YYYY-MM-DD`. */
  epoch: string;
  /** Identity keys for every peer signalled, from the digest. */
  peers: readonly PeerKey[];
}

export class TooManySignals extends Error {
  constructor(count: number) {
    super(`${count} real signals, but a set holds at most ${SIGNAL_SET_SIZE}.`);
    this.name = 'TooManySignals';
  }
}

/**
 * Turns active signals into the epoch's upload.
 *
 * A signal whose peer is no longer in the digest (they paused, deleted their account, or
 * blocked you) cannot be built: the pair key needs their public key. Those are returned in
 * `skipped` rather than thrown, because one unbuildable signal must not stop the other
 * nineteen from going out -- and must not change the size of what does
 * (the set is padded to 20 regardless, so an observer cannot tell).
 */
export function buildSignalSet(
  signals: readonly StoredSignal[],
  { self, epoch, peers }: BuildOptions,
): BuiltSet {
  if (signals.length > SIGNAL_SET_SIZE) throw new TooManySignals(signals.length);

  const keyByPeer = new Map(peers.map((p) => [p.peerId, p.identityPk]));
  const selfSk = b64urlDecode(self.sk);
  const selfPk = b64urlDecode(self.pk);

  const real: BuiltSet['real'] = [];
  const skipped: BuiltSet['skipped'] = [];
  const realBytes: Uint8Array[] = [];

  for (const signal of signals) {
    const peerPkText = keyByPeer.get(signal.peerId);
    if (!peerPkText) {
      skipped.push({ peerId: signal.peerId, intent: signal.intent, reason: 'unknown_peer' });
      continue;
    }
    let peerPk: Uint8Array;
    try {
      peerPk = b64urlDecode(peerPkText);
    } catch {
      skipped.push({ peerId: signal.peerId, intent: signal.intent, reason: 'invalid_key' });
      continue;
    }
    if (!isValidPublicKey(peerPk)) {
      // A low-order or non-canonical key would give a degenerate shared secret. The server
      // rejects such keys at registration, so reaching here means something is wrong; the
      // signal is dropped rather than built on a worthless pair key (invariant 7).
      skipped.push({ peerId: signal.peerId, intent: signal.intent, reason: 'invalid_key' });
      continue;
    }

    const key = pairKey(selfSk, selfPk, self.userId, peerPk, signal.peerId);
    const token = interestToken(key, epoch, signal.intent);
    realBytes.push(token);
    real.push({ token: b64urlEncode(token), peerId: signal.peerId, intent: signal.intent });
  }

  // paddedSet pads with CSPRNG bytes to exactly SIGNAL_SET_SIZE and shuffles with the CSPRNG.
  const tokens = paddedSet(realBytes).map(b64urlEncode);
  return { tokens, real, skipped };
}
