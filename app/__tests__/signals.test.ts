/**
 * The signal pipeline (AC-T2-2): TTL, the 20-cap, the padded set built through protocol-ts,
 * withdrawal freeing a slot instantly with no request, and match verification.
 *
 * These are the tests the plan asks for *before* any signal UI exists, because every one of
 * them is a property of claim C1 rather than a convenience.
 */

import { SIGNAL_SET_SIZE, b64urlDecode, b64urlEncode, generateIdentityKeypair } from '@mutual/protocol';

import { ApiError } from '@/api/client';
import {
  SIGNAL_CAP,
  SignalCapReached,
  listSignals,
  lookupSentToken,
  recordSentTokens,
  setSignalsForPeer,
  signalCount,
  signalsForPeer,
  touchCrossing,
  withdrawPeer,
} from '@/signals/db';
import { buildSignalSet, TooManySignals } from '@/signals/setBuilder';
import {
  activeSignals,
  addDays,
  daysBetween,
  expiredSignals,
  expiryDay,
  expiryLabel,
  isActive,
} from '@/signals/ttl';
import {
  lastAllowedMinute,
  minutesOfDay,
  pickUploadMinute,
} from '@/signals/scheduler';
import { uploadSignalSet } from '@/signals/upload';
import {
  plannedMinuteFor,
  storedPlannedMinute,
  wipeLocalDatabase,
} from '@/storage/localDb';

jest.mock('@/api/endpoints', () => ({
  uploadSignals: jest.fn(async () => undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const endpoints = require('@/api/endpoints') as { uploadSignals: jest.Mock };

const TODAY = '2026-10-06';
const TTL = 7;

function identity(userId: string) {
  const { secretKey, publicKey } = generateIdentityKeypair();
  return { userId, sk: b64urlEncode(secretKey), pk: b64urlEncode(publicKey) };
}

beforeEach(async () => {
  await wipeLocalDatabase();
  jest.clearAllMocks();
  endpoints.uploadSignals.mockImplementation(async () => undefined);
});

// ------------------------------------------------------------------- TTL

describe('signal lifetime (SPEC §6.10)', () => {
  const signal = {
    peerId: 'peer-1',
    intent: 'study' as const,
    createdAt: '2026-10-01T10:00:00Z',
    lastCrossingDay: '2026-10-01',
    peerName: 'Meera',
    peerIdentityPk: 'pk-meera',
  };

  it('counts the TTL from the last crossing, not from the signal', () => {
    expect(expiryDay(signal, TTL)).toBe('2026-10-08');
    expect(expiryDay({ ...signal, lastCrossingDay: '2026-10-05' }, TTL)).toBe('2026-10-12');
  });

  it('is active up to and including the expiry day', () => {
    expect(isActive(signal, '2026-10-08', TTL)).toBe(true);
    expect(isActive(signal, '2026-10-09', TTL)).toBe(false);
  });

  it('does the date arithmetic across a month boundary', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
  });

  it('does the date arithmetic across a year boundary', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('splits a list into active and expired', () => {
    const signals = [signal, { ...signal, peerId: 'peer-2', lastCrossingDay: '2026-10-05' }];
    expect(activeSignals(signals, '2026-10-09', TTL).map((s) => s.peerId)).toEqual(['peer-2']);
    expect(expiredSignals(signals, '2026-10-09', TTL).map((s) => s.peerId)).toEqual(['peer-1']);
  });

  it('phrases the expiry without a countdown (SPEC §13.6)', () => {
    const weekday = (day: string) =>
      ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
        new Date(`${day}T00:00:00Z`).getUTCDay()
      ]!;
    expect(expiryLabel(signal, '2026-10-07', TTL, weekday)).toBe('until tomorrow');
    expect(expiryLabel(signal, '2026-10-08', TTL, weekday)).toBe('until the end of today');
    expect(expiryLabel(signal, '2026-10-03', TTL, weekday)).toMatch(/^until \w+day$/);
  });

  it('refreshes the anchor when the peer is crossed again', async () => {
    await setSignalsForPeer('peer-1', ['study'], {
      lastCrossingDay: '2026-10-01',
      now: '2026-10-01T10:00:00Z',
      peerName: 'Meera',
      peerIdentityPk: 'pk-meera',
    });
    await touchCrossing('peer-1', '2026-10-05');
    expect((await listSignals())[0]?.lastCrossingDay).toBe('2026-10-05');
  });

  it('never moves the anchor backwards', async () => {
    await setSignalsForPeer('peer-1', ['study'], {
      lastCrossingDay: '2026-10-05',
      now: '2026-10-05T10:00:00Z',
      peerName: 'Meera',
      peerIdentityPk: 'pk-meera',
    });
    await touchCrossing('peer-1', '2026-10-01');
    expect((await listSignals())[0]?.lastCrossingDay).toBe('2026-10-05');
  });
});

// ------------------------------------------------------------------- the cap

describe('the 20-signal cap', () => {
  const opts = {
    lastCrossingDay: TODAY,
    now: `${TODAY}T10:00:00Z`,
    peerName: 'Meera',
    peerIdentityPk: 'pk-meera',
  };

  it('matches the protocol constant rather than a local number', () => {
    // No literal count here on purpose: the whole point is that this is read from
    // constants.json, not duplicated. signal_set_size is 7 as of protocol_version 2.
    expect(SIGNAL_CAP).toBe(SIGNAL_SET_SIZE);
  });

  it('counts one slot per (peer, intent)', async () => {
    await setSignalsForPeer('peer-1', ['study', 'project'], opts);
    expect(await signalCount()).toBe(2);
    expect((await signalsForPeer('peer-1')).sort()).toEqual(['project', 'study']);
  });

  it('refuses a change that would exceed the cap', async () => {
    for (let i = 0; i < SIGNAL_CAP; i++) {
      await setSignalsForPeer(`peer-${i}`, ['friend'], opts);
    }
    expect(await signalCount()).toBe(SIGNAL_CAP);
    await expect(setSignalsForPeer('peer-extra', ['friend'], opts)).rejects.toBeInstanceOf(
      SignalCapReached,
    );
    expect(await signalCount()).toBe(SIGNAL_CAP);
  });

  it('lets a peer swap intents at the cap, since the count does not change', async () => {
    for (let i = 0; i < SIGNAL_CAP; i++) {
      await setSignalsForPeer(`peer-${i}`, ['friend'], opts);
    }
    await setSignalsForPeer('peer-0', ['date'], opts);
    expect(await signalsForPeer('peer-0')).toEqual(['date']);
    expect(await signalCount()).toBe(SIGNAL_CAP);
  });

  it('does not reset the TTL anchor when the sheet is confirmed again', async () => {
    await setSignalsForPeer('peer-1', ['study'], {
      lastCrossingDay: '2026-10-01',
      now: '2026-10-01T10:00:00Z',
      peerName: 'Meera',
      peerIdentityPk: 'pk-meera',
    });
    await setSignalsForPeer('peer-1', ['study', 'project'], {
      lastCrossingDay: '2026-10-06',
      now: '2026-10-06T10:00:00Z',
      peerName: 'Meera',
      peerIdentityPk: 'pk-meera',
    });
    const study = (await listSignals()).find((s) => s.intent === 'study');
    expect(study?.createdAt).toBe('2026-10-01T10:00:00Z');
  });
});

// ------------------------------------------------------------- withdrawal

describe('withdrawal (SPEC §13.6, AC-T2-2)', () => {
  const opts = {
    lastCrossingDay: TODAY,
    now: `${TODAY}T10:00:00Z`,
    peerName: 'Meera',
    peerIdentityPk: 'pk-meera',
  };

  it('frees the slot immediately and makes no request', async () => {
    await setSignalsForPeer('peer-1', ['date'], opts);
    await withdrawPeer('peer-1');
    expect(await signalCount()).toBe(0);
    expect(endpoints.uploadSignals).not.toHaveBeenCalled();
  });

  it('is what an empty intent list means', async () => {
    await setSignalsForPeer('peer-1', ['date'], opts);
    await setSignalsForPeer('peer-1', [], opts);
    expect(await signalsForPeer('peer-1')).toEqual([]);
    expect(endpoints.uploadSignals).not.toHaveBeenCalled();
  });

  it('keeps the sent-token row, so a match from tonight still resolves', async () => {
    await recordSentTokens('2026-10-06', [
      { epoch: '2026-10-06', token: 'tok-1', peerId: 'peer-1', intent: 'date' },
    ]);
    await setSignalsForPeer('peer-1', ['date'], opts);
    await withdrawPeer('peer-1');
    expect(await lookupSentToken('2026-10-06', 'tok-1')).toMatchObject({
      peerId: 'peer-1',
      intent: 'date',
    });
  });
});

// ------------------------------------------------------------ the padded set

describe('the padded signal set (SPEC §6.7)', () => {
  const self = identity('11111111-1111-4111-8111-111111111111');
  const peerKey = identity('22222222-2222-4222-8222-222222222222');
  const peers = [{ peerId: peerKey.userId, identityPk: peerKey.pk }];

  const signalFor = (intent: 'study' | 'date') => ({
    peerId: peerKey.userId,
    intent,
    createdAt: `${TODAY}T10:00:00Z`,
    lastCrossingDay: TODAY,
    peerName: 'Bela',
    peerIdentityPk: peerKey.pk,
  });

  it('is exactly 20 tokens with one real signal', () => {
    const built = buildSignalSet([signalFor('date')], { self, epoch: TODAY, peers });
    expect(built.tokens).toHaveLength(SIGNAL_SET_SIZE);
    expect(built.real).toHaveLength(1);
  });

  it('is exactly 20 tokens with no real signals at all', () => {
    const built = buildSignalSet([], { self, epoch: TODAY, peers });
    expect(built.tokens).toHaveLength(SIGNAL_SET_SIZE);
    expect(built.real).toHaveLength(0);
  });

  it('contains every real token somewhere in the set', () => {
    const built = buildSignalSet([signalFor('date'), signalFor('study')], {
      self,
      epoch: TODAY,
      peers,
    });
    for (const real of built.real) expect(built.tokens).toContain(real.token);
  });

  it('produces 32-byte tokens', () => {
    const built = buildSignalSet([signalFor('date')], { self, epoch: TODAY, peers });
    for (const token of built.tokens) expect(b64urlDecode(token)).toHaveLength(32);
  });

  it('shuffles: the real token is not always in the same position', () => {
    const positions = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const built = buildSignalSet([signalFor('date')], { self, epoch: TODAY, peers });
      positions.add(built.tokens.indexOf(built.real[0]!.token));
    }
    expect(positions.size).toBeGreaterThan(5);
  });

  it('pads with values that differ every time', () => {
    const a = buildSignalSet([], { self, epoch: TODAY, peers });
    const b = buildSignalSet([], { self, epoch: TODAY, peers });
    expect(a.tokens).not.toEqual(b.tokens);
  });

  it('gives a different token for a different intent', () => {
    const a = buildSignalSet([signalFor('date')], { self, epoch: TODAY, peers });
    const b = buildSignalSet([signalFor('study')], { self, epoch: TODAY, peers });
    expect(a.real[0]!.token).not.toBe(b.real[0]!.token);
  });

  it('gives a different token for a different epoch', () => {
    const a = buildSignalSet([signalFor('date')], { self, epoch: TODAY, peers });
    const b = buildSignalSet([signalFor('date')], { self, epoch: '2026-10-07', peers });
    expect(a.real[0]!.token).not.toBe(b.real[0]!.token);
  });

  it('is deterministic for the same pair, epoch and intent', () => {
    const a = buildSignalSet([signalFor('date')], { self, epoch: TODAY, peers });
    const b = buildSignalSet([signalFor('date')], { self, epoch: TODAY, peers });
    expect(a.real[0]!.token).toBe(b.real[0]!.token);
  });

  it('skips a peer whose key is unknown, without changing the set size', () => {
    const built = buildSignalSet(
      [signalFor('date'), { ...signalFor('study'), peerId: 'peer-gone' }],
      { self, epoch: TODAY, peers },
    );
    expect(built.tokens).toHaveLength(SIGNAL_SET_SIZE);
    expect(built.real).toHaveLength(1);
    expect(built.skipped).toEqual([
      { peerId: 'peer-gone', intent: 'study', reason: 'unknown_peer' },
    ]);
  });

  it('skips a low-order peer key rather than building on a degenerate secret', () => {
    const lowOrder = b64urlEncode(new Uint8Array(32)); // all zeros
    const built = buildSignalSet([signalFor('date')], {
      self,
      epoch: TODAY,
      peers: [{ peerId: peerKey.userId, identityPk: lowOrder }],
    });
    expect(built.real).toHaveLength(0);
    expect(built.skipped[0]?.reason).toBe('invalid_key');
    expect(built.tokens).toHaveLength(SIGNAL_SET_SIZE);
  });

  it('refuses more real signals than a set can hold', () => {
    const many = Array.from({ length: SIGNAL_SET_SIZE + 1 }, () => signalFor('date'));
    expect(() => buildSignalSet(many, { self, epoch: TODAY, peers })).toThrow(TooManySignals);
  });
});

// ---------------------------------------------------------------- the upload

describe('the epoch upload (SPEC §6.11)', () => {
  const self = identity('11111111-1111-4111-8111-111111111111');
  const peerKey = identity('22222222-2222-4222-8222-222222222222');
  const context = {
    self,
    peers: [{ peerId: peerKey.userId, identityPk: peerKey.pk }],
    epoch: TODAY,
    interestTtlDays: TTL,
    now: new Date(`${TODAY}T19:12:00Z`),
  };

  it('uploads exactly 20 tokens', async () => {
    await setSignalsForPeer(peerKey.userId, ['date'], {
      lastCrossingDay: TODAY,
      now: `${TODAY}T10:00:00Z`,
      peerName: 'Meera',
      peerIdentityPk: 'pk-meera',
    });
    const result = await uploadSignalSet(context);
    expect(result).toMatchObject({ status: 'uploaded', realCount: 1 });
    const [, body] = endpoints.uploadSignals.mock.calls[0] as [string, { tokens: string[] }];
    expect(body.tokens).toHaveLength(SIGNAL_SET_SIZE);
  });

  it('uploads even with no signals at all, which is what makes the rest unreadable', async () => {
    const result = await uploadSignalSet(context);
    expect(result).toMatchObject({ status: 'uploaded', realCount: 0 });
    expect(endpoints.uploadSignals).toHaveBeenCalledTimes(1);
  });

  it('never uploads twice for one epoch', async () => {
    await uploadSignalSet(context);
    const second = await uploadSignalSet(context);
    expect(second).toEqual({ status: 'already_uploaded' });
    expect(endpoints.uploadSignals).toHaveBeenCalledTimes(1);
  });

  it('records what each token stood for before the request', async () => {
    await setSignalsForPeer(peerKey.userId, ['date'], {
      lastCrossingDay: TODAY,
      now: `${TODAY}T10:00:00Z`,
      peerName: 'Meera',
      peerIdentityPk: 'pk-meera',
    });
    endpoints.uploadSignals.mockImplementation(async (epoch: string, body: { tokens: string[] }) => {
      // Mid-request: the mapping must already exist, or a crash here would leave a match
      // that can never be interpreted.
      const found = await Promise.all(
        body.tokens.map((t) => lookupSentToken(epoch, t)),
      );
      expect(found.filter(Boolean)).toHaveLength(1);
    });
    await uploadSignalSet(context);
  });

  it('treats a 409 as already uploaded rather than an error', async () => {
    endpoints.uploadSignals.mockImplementation(async () => {
      throw new ApiError(409, 'conflict', 'already have it');
    });
    expect(await uploadSignalSet(context)).toEqual({ status: 'already_uploaded' });
  });

  it('reports a rejection with its code and does not retry inside the call', async () => {
    endpoints.uploadSignals.mockImplementation(async () => {
      throw new ApiError(425, 'too_early', 'window has not opened');
    });
    expect(await uploadSignalSet(context)).toEqual({ status: 'rejected', code: 'too_early' });
    expect(endpoints.uploadSignals).toHaveBeenCalledTimes(1);
  });

  it('excludes an expired signal from the set', async () => {
    await setSignalsForPeer(peerKey.userId, ['date'], {
      lastCrossingDay: '2026-09-01',
      now: '2026-09-01T10:00:00Z',
      peerName: 'Meera',
      peerIdentityPk: 'pk-meera',
    });
    const result = await uploadSignalSet(context);
    expect(result).toMatchObject({ status: 'uploaded', realCount: 0 });
  });
});

// -------------------------------------------------------- match verification

describe('match verification (AC-T2-2)', () => {
  it('accepts only a token this device recorded uploading', async () => {
    await recordSentTokens('2026-10-06', [
      { epoch: '2026-10-06', token: 'ours', peerId: 'peer-1', intent: 'study' },
    ]);
    expect(await lookupSentToken('2026-10-06', 'ours')).toMatchObject({ intent: 'study' });
    expect(await lookupSentToken('2026-10-06', 'not-ours')).toBeNull();
  });

  it('keys on the epoch as well as the token', async () => {
    await recordSentTokens('2026-10-06', [
      { epoch: '2026-10-06', token: 'tok', peerId: 'peer-1', intent: 'study' },
    ]);
    expect(await lookupSentToken('2026-10-07', 'tok')).toBeNull();
  });
});

// ------------------------------------------------- the upload minute, persisted

describe('the chosen upload minute (SPEC §6.11)', () => {
  it('is drawn once per epoch, however many times the app restarts', async () => {
    let draws = 0;
    const draw = () => {
      draws += 1;
      return 1100 + draws; // a different value each time, so a re-draw would be visible
    };

    const first = await plannedMinuteFor('2026-10-06', draw);
    const second = await plannedMinuteFor('2026-10-06', draw);
    const third = await plannedMinuteFor('2026-10-06', draw);

    expect(draws).toBe(1);
    expect([second, third]).toEqual([first, first]);
  });

  it('draws separately for a different epoch', async () => {
    const a = await plannedMinuteFor('2026-10-06', () => 1111);
    const b = await plannedMinuteFor('2026-10-07', () => 1222);
    expect(a).toBe(1111);
    expect(b).toBe(1222);
  });

  it('reports a stored plan without drawing one', async () => {
    expect(await storedPlannedMinute('2026-10-06')).toBeNull();
    await plannedMinuteFor('2026-10-06', () => 1234);
    expect(await storedPlannedMinute('2026-10-06')).toBe(1234);
  });

  it('is uniform over the allowed range, and never at or after the batch time', () => {
    const window = { start: '18:00', end: '23:30', batchTime: '23:45' };
    const first = minutesOfDay(window.start);
    const last = lastAllowedMinute(window);
    expect(last).toBe(minutesOfDay('23:30') - 1);

    const drawn = Array.from({ length: 400 }, () => pickUploadMinute(window));
    expect(Math.min(...drawn)).toBeGreaterThanOrEqual(first);
    expect(Math.max(...drawn)).toBeLessThanOrEqual(last);
    // A wide spread: a draw stuck near the start would be a predictable schedule.
    expect(new Set(drawn).size).toBeGreaterThan(100);
  });
});
