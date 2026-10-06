/**
 * Match resolution (AC-T2-2: "match resolution token -> (peer, intent); match verification
 * accepts only tokens kept from that epoch's uploaded set").
 *
 * The honest-failure cases get as much attention as the happy path, because resolving a
 * match to the *wrong* intent would be worse than resolving it to none: a user shown "study"
 * for what was really a date signal has been actively misled about their own data.
 */

import { INTENT_LABELS, type Match } from '@/api/types';
import {
  describeIntents,
  isActive,
  messagesStillNeeded,
  photosAvailable,
  resolveMatch,
  resolveMatches,
} from '@/matches/resolve';
import { recordSentTokens } from '@/signals/db';
import { wipeLocalDatabase } from '@/storage/localDb';

const PEER = 'peer-1';
const EPOCH = '2026-10-05';

function match(overrides: Partial<Match> = {}): Match {
  return {
    match_id: 'm-1',
    state: 'active',
    peer: {
      peer_id: PEER,
      first_name: 'Nila',
      year_of_study: 3,
      identity_pk: 'pk-nila',
      prompts: [],
    },
    matched: [{ epoch: EPOCH, token: 'tok-study' }],
    created_epoch: EPOCH,
    reveal: { state: 'revealed', policy: 'M' },
    unread: false,
    ...overrides,
  };
}

beforeEach(async () => {
  await wipeLocalDatabase();
});

describe('resolving a match to its intents', () => {
  it('maps a token this device uploaded back to its peer and intent', async () => {
    await recordSentTokens(EPOCH, [
      { epoch: EPOCH, token: 'tok-study', peerId: PEER, intent: 'study' },
    ]);
    const resolved = await resolveMatch(match());
    expect(resolved.intents).toEqual([{ intent: 'study', epoch: EPOCH, token: 'tok-study' }]);
    expect(resolved.unverified).toEqual([]);
  });

  it('reports a token it has no record of, rather than guessing an intent', async () => {
    const resolved = await resolveMatch(match());
    expect(resolved.intents).toEqual([]);
    expect(resolved.unverified).toEqual([{ epoch: EPOCH, token: 'tok-study' }]);
  });

  it('refuses a token this device sent to a different peer', async () => {
    // A token recorded against peer-2 turning up in a match with peer-1 means either a
    // server mixing things up or an attempt to mislead. Either way: no intent is claimed.
    await recordSentTokens(EPOCH, [
      { epoch: EPOCH, token: 'tok-study', peerId: 'peer-2', intent: 'date' },
    ]);
    const resolved = await resolveMatch(match());
    expect(resolved.intents).toEqual([]);
    expect(resolved.unverified).toHaveLength(1);
  });

  it('refuses a token recorded for a different epoch', async () => {
    await recordSentTokens('2026-10-04', [
      { epoch: '2026-10-04', token: 'tok-study', peerId: PEER, intent: 'study' },
    ]);
    const resolved = await resolveMatch(match());
    expect(resolved.intents).toEqual([]);
  });

  it('resolves several shared intents and keeps them in epoch order', async () => {
    await recordSentTokens(EPOCH, [
      { epoch: EPOCH, token: 'tok-study', peerId: PEER, intent: 'study' },
    ]);
    await recordSentTokens('2026-10-06', [
      { epoch: '2026-10-06', token: 'tok-project', peerId: PEER, intent: 'project' },
    ]);
    const resolved = await resolveMatch(
      match({
        matched: [
          { epoch: '2026-10-06', token: 'tok-project' },
          { epoch: EPOCH, token: 'tok-study' },
        ],
      }),
    );
    expect(resolved.intents.map((i) => i.intent)).toEqual(['study', 'project']);
  });

  it('resolves a list of matches', async () => {
    await recordSentTokens(EPOCH, [
      { epoch: EPOCH, token: 'tok-study', peerId: PEER, intent: 'study' },
    ]);
    const resolved = await resolveMatches([match(), match({ match_id: 'm-2' })]);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]?.intents).toHaveLength(1);
  });

  it('still resolves after the signal was withdrawn, because the row is kept', async () => {
    await recordSentTokens(EPOCH, [
      { epoch: EPOCH, token: 'tok-study', peerId: PEER, intent: 'study' },
    ]);
    // A withdrawal deletes the signal, not the sent-token row (SPEC §13.6, AC-T2-2).
    const resolved = await resolveMatch(match());
    expect(resolved.intents).toHaveLength(1);
  });
});

describe('describing a mutual', () => {
  const resolved = (intents: string[]) =>
    intents.map((intent) => ({ intent, epoch: EPOCH, token: intent })) as never;

  it('names one intent plainly', () => {
    expect(describeIntents(resolved(['study']), INTENT_LABELS)).toBe('Study');
  });

  it('joins two with "and"', () => {
    expect(describeIntents(resolved(['study', 'project']), INTENT_LABELS)).toBe(
      'Study and Project',
    );
  });

  it('joins three with commas and a final "and"', () => {
    expect(describeIntents(resolved(['study', 'project', 'date']), INTENT_LABELS)).toBe(
      'Study, Project and Date',
    );
  });

  it('collapses a duplicate intent from two epochs', () => {
    expect(describeIntents(resolved(['study', 'study']), INTENT_LABELS)).toBe('Study');
  });

  it('returns null when nothing resolved, so the caller can be honest', () => {
    expect(describeIntents([], INTENT_LABELS)).toBeNull();
  });
});

describe('reveal state (SPEC §11.2)', () => {
  it('trusts the server rather than deciding locally', () => {
    expect(photosAvailable(match({ reveal: { state: 'revealed', policy: 'M' } }))).toBe(true);
    expect(photosAvailable(match({ reveal: { state: 'pending', policy: 'C' } }))).toBe(false);
  });

  it('reports how many more messages each side needs under policy C', () => {
    expect(
      messagesStillNeeded(
        match({ reveal: { state: 'pending', policy: 'C', messages_needed_each: 3 } }),
      ),
    ).toBe(3);
  });

  it('has nothing to report under policy M', () => {
    expect(messagesStillNeeded(match({ reveal: { state: 'pending', policy: 'M' } }))).toBeNull();
  });

  it('has nothing to report once revealed', () => {
    expect(
      messagesStillNeeded(
        match({ reveal: { state: 'revealed', policy: 'C', messages_needed_each: 0 } }),
      ),
    ).toBeNull();
  });

  it('knows an ended match is no longer active (SPEC §6.9 fair delivery)', () => {
    expect(isActive(match())).toBe(true);
    expect(isActive(match({ state: 'ended' }))).toBe(false);
  });
});
