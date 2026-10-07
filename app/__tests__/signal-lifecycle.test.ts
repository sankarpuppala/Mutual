/**
 * The three ways a signal is supposed to end (SPEC.md §6.10), each of which was written but
 * never wired up.
 *
 * §6.10: "A signal is active from creation until `interest_ttl_days` after the most recent
 * crossing with that peer, or until it is withdrawn, or until a match containing its
 * `(peer, intent)` token is received." Withdrawal worked. The other two did not, and both
 * failed silently, which is why neither had been noticed:
 *
 *  - `expiredSignals()` had no caller, so dead rows stayed in the table. `activeSignals`
 *    kept them out of the upload, so nothing wrong was ever sent -- but `signalCount()` is
 *    `COUNT(*)`, so after a week a user could be told "All 20 signals are out" while
 *    holding none that would ever be uploaded again.
 *  - `touchCrossing()` had no caller, so the TTL anchor was written once at creation.
 *    A signal to someone crossed every single day still expired seven days after the
 *    *first* crossing -- the exact opposite of what the TTL is for.
 *  - Nothing cleared a signal when its match arrived, so the slot stayed used and the same
 *    token was re-uploaded every epoch. Per §6.9 the server appends a newly matching token
 *    to an existing match as another shared intent, so the number of shared intents both
 *    sides see would climb night after night with neither of them doing anything.
 */

import type { Match } from '@/api/types';
import { resolveMatch } from '@/matches/resolve';
import {
  clearSignal,
  deleteExpiredSignals,
  listSignals,
  recordSentTokens,
  setSignalsForPeer,
  signalCount,
  touchCrossing,
} from '@/signals/db';
import { activeSignals } from '@/signals/ttl';
import { wipeLocalDatabase } from '@/storage/localDb';

const TTL = 7;

function opts(lastCrossingDay: string, peerId = 'peer-1') {
  return {
    lastCrossingDay,
    now: `${lastCrossingDay}T09:00:00.000Z`,
    peerName: `Name ${peerId}`,
    peerIdentityPk: 'cGstdGhpcnR5LXR3by1ieXRlcy1sb25nLXZhbHVlLWhlcmU',
  };
}

beforeEach(async () => {
  await wipeLocalDatabase();
});

describe('expiry frees the slot it occupies', () => {
  it('deletes rows whose TTL has run out and keeps the ones still active', async () => {
    await setSignalsForPeer('old', ['study'], opts('2026-09-20', 'old'));
    await setSignalsForPeer('recent', ['friend'], opts('2026-10-05', 'recent'));
    expect(await signalCount()).toBe(2);

    // 2026-10-07 is 17 days after the old crossing and 2 after the recent one.
    const removed = await deleteExpiredSignals('2026-10-07', TTL);

    expect(removed).toBe(1);
    expect(await signalCount()).toBe(1);
    expect((await listSignals()).map((s) => s.peerId)).toEqual(['recent']);
  });

  it('agrees with activeSignals, which is what the upload filters on', async () => {
    await setSignalsForPeer('edge', ['date'], opts('2026-09-30', 'edge'));
    const today = '2026-10-07'; // exactly TTL days after, so still active (inclusive)

    expect(activeSignals(await listSignals(), today, TTL)).toHaveLength(1);
    expect(await deleteExpiredSignals(today, TTL)).toBe(0);

    const tomorrow = '2026-10-08';
    expect(activeSignals(await listSignals(), tomorrow, TTL)).toHaveLength(0);
    expect(await deleteExpiredSignals(tomorrow, TTL)).toBe(1);
  });
});

describe('a new crossing moves the TTL anchor forward', () => {
  it('keeps a signal alive for someone who keeps being crossed', async () => {
    await setSignalsForPeer('peer-1', ['study'], opts('2026-09-30'));

    // Six days later they are crossed again, which is what the digest reports.
    await touchCrossing('peer-1', '2026-10-06');

    // Without the touch this row would have died on the 8th.
    expect(await deleteExpiredSignals('2026-10-10', TTL)).toBe(0);
    expect(await deleteExpiredSignals('2026-10-14', TTL)).toBe(1);
  });

  it('never moves the anchor backwards', async () => {
    await setSignalsForPeer('peer-1', ['study'], opts('2026-10-05'));
    await touchCrossing('peer-1', '2026-09-01');
    expect((await listSignals())[0]!.lastCrossingDay).toBe('2026-10-05');
  });
});

describe('a match ends the signal that produced it', () => {
  const EPOCH = '2026-10-06';
  const TOKEN = 'dG9rZW4tZm9yLXN0dWR5LXdpdGgtcGVlci1vbmUtaGVyZQ';

  function matchWith(peerId: string): Match {
    return {
      match_id: 'match-1',
      peer: {
        peer_id: peerId,
        first_name: 'Meera',
        year_of_study: 3,
        identity_pk: 'cGstbWVlcmEtdGhpcnR5LXR3by1ieXRlcy1sb25nLXZhbA',
        prompts: [],
      },
      matched: [{ epoch: EPOCH, token: TOKEN }],
      state: 'active',
      notified_at: '2026-10-07T08:00:00+05:30',
      reveal: { policy: 'M', state: 'revealed' },
    } as unknown as Match;
  }

  it('clears the (peer, intent) the match resolved to', async () => {
    await setSignalsForPeer('peer-1', ['study', 'project'], opts('2026-10-05'));
    await recordSentTokens(EPOCH, [
      { epoch: EPOCH, token: TOKEN, peerId: 'peer-1', intent: 'study' },
    ]);

    const resolved = await resolveMatch(matchWith('peer-1'));

    expect(resolved.intents.map((i) => i.intent)).toEqual(['study']);
    // The matched intent is gone; the other one is untouched.
    expect((await listSignals()).map((s) => s.intent)).toEqual(['project']);
  });

  it('is idempotent, so resolving the same match twice is harmless', async () => {
    await setSignalsForPeer('peer-1', ['study'], opts('2026-10-05'));
    await recordSentTokens(EPOCH, [
      { epoch: EPOCH, token: TOKEN, peerId: 'peer-1', intent: 'study' },
    ]);

    await resolveMatch(matchWith('peer-1'));
    await resolveMatch(matchWith('peer-1'));
    expect(await signalCount()).toBe(0);
  });

  it('leaves the signal alone when the token cannot be accounted for', async () => {
    await setSignalsForPeer('peer-1', ['study'], opts('2026-10-05'));
    await recordSentTokens(EPOCH, [
      { epoch: EPOCH, token: TOKEN, peerId: 'peer-1', intent: 'study' },
    ]);

    // A token this device sent to peer-1 turning up in a match with peer-2 is either a
    // server mixing things up or an attempt to mislead. Neither may end a real signal.
    const resolved = await resolveMatch(matchWith('peer-2'));

    expect(resolved.intents).toHaveLength(0);
    expect(resolved.unverified).toHaveLength(1);
    expect(await signalCount()).toBe(1);
  });

  it('clearSignal removes exactly one intent', async () => {
    await setSignalsForPeer('peer-1', ['study', 'project', 'friend'], opts('2026-10-05'));
    await clearSignal('peer-1', 'project');
    expect((await listSignals()).map((s) => s.intent).sort()).toEqual(['friend', 'study']);
  });
});
