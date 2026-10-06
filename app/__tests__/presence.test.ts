/**
 * The presence pipeline (AC-T2-2): encounter tokens and the padded set built through
 * protocol-ts, and **no daily key, EID or time ever passed to `api/client.ts`**.
 *
 * The last one is the test that matters most. Invariant 3 is a claim about what crosses the
 * network boundary, so the test watches that boundary: it captures the exact request body
 * and asserts that nothing in it is a key, an id, an interval or a window count.
 */

import {
  ENCOUNTER_PAD_BLOCK,
  b64urlDecode,
  b64urlEncode,
  eid,
  ephemeralPrivateKey,
  newDailyKey,
} from '@mutual/protocol';

import {
  buildSchedule,
  ensureLookahead,
  forgetDay,
  forgetStaleKeys,
  ownEid,
  ownEphemeralKey,
} from '@/presence/dailyKeys';
import { clearSightings, drainInto, storedSightings } from '@/presence/drain';
import {
  buildEncounters,
  buildPresenceUpload,
  qualifying,
  timeBlockFor,
} from '@/presence/encounters';
import { uploadPresenceFor } from '@/presence/upload';
import { FakeBle } from '@/presence/fakeBle';
import type { Sighting } from '@/presence/bleAdapter';
import {
  getDailyKey,
  getEncounterTime,
  hasUploaded,
  wipeLocalDatabase,
} from '@/storage/localDb';

jest.mock('@/api/endpoints', () => ({
  uploadPresence: jest.fn(async () => undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const endpoints = require('@/api/endpoints') as { uploadPresence: jest.Mock };

const DAY = '2026-10-05';
const NOW = new Date('2026-10-06T00:30:00Z');

beforeEach(async () => {
  await wipeLocalDatabase();
  jest.clearAllMocks();
  endpoints.uploadPresence.mockImplementation(async () => undefined);
});

/** A sighting pair that both sides can really compute, as two devices would. */
function realPair(day: string, interval: number) {
  const dkA = newDailyKey();
  const dkB = newDailyKey();
  return {
    dkA,
    eidA: b64urlEncode(eid(dkA, interval)),
    eskA: ephemeralPrivateKey(dkA, interval),
    eidB: b64urlEncode(eid(dkB, interval)),
    eskB: ephemeralPrivateKey(dkB, interval),
    day,
    interval,
  };
}

// ------------------------------------------------------------- daily keys

describe('daily keys (SPEC §6.8, §13.8)', () => {
  it('keeps keys for today and two days ahead', async () => {
    const days = await ensureLookahead('2026-10-06');
    expect(days).toEqual(['2026-10-06', '2026-10-07', '2026-10-08']);
    for (const day of days) expect(await getDailyKey(day)).toBeTruthy();
  });

  it('never replaces an existing key, so the schedule stays stable', async () => {
    await ensureLookahead('2026-10-06');
    const before = await getDailyKey('2026-10-06');
    await ensureLookahead('2026-10-06');
    expect(await getDailyKey('2026-10-06')).toBe(before);
  });

  it('schedules every interval of today and tomorrow except the midnight ones', async () => {
    await ensureLookahead('2026-10-06');
    const schedule = await buildSchedule('2026-10-06');
    expect(schedule).toHaveLength(94 * 2);
    expect(schedule.some((e) => e.interval === 0 || e.interval === 95)).toBe(false);
    expect(new Set(schedule.map((e) => e.day))).toEqual(
      new Set(['2026-10-06', '2026-10-07']),
    );
  });

  it('schedules 32-byte ids', async () => {
    await ensureLookahead('2026-10-06');
    for (const entry of await buildSchedule('2026-10-06')) {
      expect(b64urlDecode(entry.eid)).toHaveLength(32);
    }
  });

  it('derives the same id the schedule advertises', async () => {
    await ensureLookahead('2026-10-06');
    const schedule = await buildSchedule('2026-10-06');
    const entry = schedule.find((e) => e.day === '2026-10-06' && e.interval === 40)!;
    expect(await ownEid('2026-10-06', 40)).toBe(entry.eid);
  });

  it('forgets a day, after which its sightings can no longer be turned into tokens', async () => {
    await ensureLookahead('2026-10-06');
    await forgetDay('2026-10-06');
    expect(await getDailyKey('2026-10-06')).toBeNull();
    expect(await ownEphemeralKey('2026-10-06', 40)).toBeNull();
  });

  it('forgets keys for days that can no longer be uploaded', async () => {
    await ensureLookahead('2026-10-06');
    const stale = await forgetStaleKeys('2026-10-07');
    expect(stale).toEqual(['2026-10-06']);
    expect(await getDailyKey('2026-10-07')).toBeTruthy();
  });
});

// ------------------------------------------------------------ the dwell rule

describe('the dwell rule (SPEC §6.13)', () => {
  const base: Sighting = {
    day: DAY,
    interval: 40,
    ownEid: 'own',
    heardEid: 'heard',
    windows: 4,
  };

  it('needs 4 windows in one interval by default', () => {
    expect(qualifying([{ ...base, windows: 3 }])).toEqual([]);
    expect(qualifying([base])).toHaveLength(1);
  });

  it('never sums counts across intervals: the best single sighting counts', () => {
    const brushPasts = [
      { ...base, interval: 10, windows: 3 },
      { ...base, interval: 20, windows: 3 },
      { ...base, interval: 30, windows: 3 },
    ];
    expect(qualifying(brushPasts)).toEqual([]);
  });

  it('keeps the best interval for a pair, not every interval', () => {
    const result = qualifying([
      { ...base, interval: 10, windows: 5 },
      { ...base, interval: 20, windows: 9 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.windows).toBe(9);
  });

  it('drops the midnight intervals however long the dwell', () => {
    expect(qualifying([{ ...base, interval: 0, windows: 15 }])).toEqual([]);
    expect(qualifying([{ ...base, interval: 95, windows: 15 }])).toEqual([]);
  });

  it('honours a threshold from the server config', () => {
    expect(qualifying([{ ...base, windows: 4 }], 8)).toEqual([]);
    expect(qualifying([{ ...base, windows: 8 }], 8)).toHaveLength(1);
  });
});

describe('the coarse time block (invariant 4)', () => {
  it('maps an interval to one of four blocks and nothing finer', () => {
    expect(timeBlockFor(0)).toBe('night'); // 00:00
    expect(timeBlockFor(32)).toBe('morning'); // 08:00
    expect(timeBlockFor(56)).toBe('afternoon'); // 14:00
    expect(timeBlockFor(76)).toBe('evening'); // 19:00
    expect(timeBlockFor(92)).toBe('night'); // 23:00
  });
});

// ----------------------------------------------------------- token building

describe('encounter tokens (SPEC §6.13)', () => {
  it('both devices compute the same token from the same crossing', async () => {
    const pair = realPair(DAY, 40);
    const fromA = await buildEncounters(
      DAY,
      [{ day: DAY, interval: 40, ownEid: pair.eidA, heardEid: pair.eidB, windows: 6 }],
      { ownEphemeralKey: async () => pair.eskA },
    );
    const fromB = await buildEncounters(
      DAY,
      [{ day: DAY, interval: 40, ownEid: pair.eidB, heardEid: pair.eidA, windows: 6 }],
      { ownEphemeralKey: async () => pair.eskB },
    );
    expect(fromA[0]?.token).toBe(fromB[0]?.token);
  });

  it('records the coarse block alongside the token', async () => {
    const pair = realPair(DAY, 76); // 19:00
    const built = await buildEncounters(
      DAY,
      [{ day: DAY, interval: 76, ownEid: pair.eidA, heardEid: pair.eidB, windows: 6 }],
      { ownEphemeralKey: async () => pair.eskA },
    );
    expect(built[0]?.block).toBe('evening');
  });

  it('drops a heard id that is not a valid public key', async () => {
    const pair = realPair(DAY, 40);
    const built = await buildEncounters(
      DAY,
      [
        {
          day: DAY,
          interval: 40,
          ownEid: pair.eidA,
          heardEid: b64urlEncode(new Uint8Array(32)),
          windows: 9,
        },
      ],
      { ownEphemeralKey: async () => pair.eskA },
    );
    expect(built).toEqual([]);
  });

  it('builds nothing once the daily key is gone', async () => {
    const pair = realPair(DAY, 40);
    const built = await buildEncounters(
      DAY,
      [{ day: DAY, interval: 40, ownEid: pair.eidA, heardEid: pair.eidB, windows: 6 }],
      { ownEphemeralKey: async () => null },
    );
    expect(built).toEqual([]);
  });

  it('pads the upload to a multiple of 256 and keeps every real token', () => {
    const encounters = Array.from({ length: 3 }, (_, i) => ({
      token: b64urlEncode(new Uint8Array(32).fill(i + 1)),
      day: DAY,
      block: 'evening' as const,
      windows: 5,
    }));
    const { encounters: padded, kept } = buildPresenceUpload(encounters);
    expect(padded).toHaveLength(ENCOUNTER_PAD_BLOCK);
    expect(kept).toHaveLength(3);
    for (const e of encounters) expect(padded).toContain(e.token);
  });

  it('keeps the longest dwells when there are more than the maximum', () => {
    const encounters = Array.from({ length: 1100 }, (_, i) => ({
      token: b64urlEncode(
        new Uint8Array(32).map((_, j) => (j === 0 ? i % 256 : Math.floor(i / 256))),
      ),
      day: DAY,
      block: 'evening' as const,
      windows: i % 15 + 1,
    }));
    const { kept } = buildPresenceUpload(encounters);
    expect(kept).toHaveLength(1024);
    expect(Math.min(...kept.map((k) => k.windows))).toBeGreaterThan(1);
  });
});

// ------------------------------------------------------------------ draining

describe('draining (SPEC §14.4)', () => {
  it('stores what the adapter returns and leaves nothing behind in the adapter', async () => {
    const ble = new FakeBle({ seed: 4, peers: 5 });
    await ble.setSchedule([{ day: DAY, interval: 40, eid: 'eid-40' }]);
    ble.generateDay(DAY);

    const count = await drainInto(ble);
    expect(count).toBeGreaterThan(0);
    expect(await ble.drain()).toEqual([]);
    expect((await storedSightings(DAY)).length).toBe(count);
  });

  it('merges a repeated drain with MAX, never a sum', async () => {
    const ble = new FakeBle({ seed: 1 });
    await ble.setSchedule([{ day: DAY, interval: 40, eid: 'own' }]);

    // Two drains covering the same interval and pair.
    const inject = async (windows: number) => {
      const adapter = {
        ...ble,
        name: 'fake' as const,
        drain: async () => [
          { day: DAY, interval: 40, ownEid: 'own', heardEid: 'heard', windows },
        ],
      } as unknown as FakeBle;
      await drainInto(adapter);
    };
    await inject(5);
    await inject(3);
    expect((await storedSightings(DAY))[0]?.windows).toBe(5);
    await inject(9);
    expect((await storedSightings(DAY))[0]?.windows).toBe(9);
  });

  it('clears a day once it has been dealt with', async () => {
    const ble = new FakeBle({ seed: 2, peers: 3 });
    await ble.setSchedule([{ day: DAY, interval: 40, eid: 'own' }]);
    ble.generateDay(DAY);
    await drainInto(ble);
    await clearSightings(DAY);
    expect(await storedSightings(DAY)).toEqual([]);
  });
});

// ----------------------------------------------------- the network boundary

describe('the presence upload (invariant 3, AC-T2-2)', () => {
  /** Builds a day of real sightings in the database, with the key still present. */
  async function seedRealDay(): Promise<{ eidB: string }> {
    await ensureLookahead(DAY);
    const own = await ownEid(DAY, 40);
    const dkB = newDailyKey();
    const eidB = b64urlEncode(eid(dkB, 40));
    const adapter = {
      name: 'fake' as const,
      drain: async () => [
        { day: DAY, interval: 40, ownEid: own!, heardEid: eidB, windows: 7 },
      ],
    } as unknown as FakeBle;
    await drainInto(adapter);
    return { eidB };
  }

  it('sends only a list of encounter tokens: no key, id, interval, window or time', async () => {
    const { eidB } = await seedRealDay();
    await uploadPresenceFor(DAY, { minWindows: 4, now: NOW });

    expect(endpoints.uploadPresence).toHaveBeenCalledTimes(1);
    const [day, body] = endpoints.uploadPresence.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(day).toBe(DAY);

    // The body has exactly one field.
    expect(Object.keys(body)).toEqual(['encounters']);

    const encounters = body.encounters as string[];
    expect(encounters.length % ENCOUNTER_PAD_BLOCK).toBe(0);
    for (const token of encounters) expect(b64urlDecode(token)).toHaveLength(32);

    // Nothing recognisable as a key or an id appears anywhere. (A substring search for
    // words like "window" would be unsound here: the padding is random base64url and can
    // contain any letter sequence by chance. The structural checks above are the real
    // assertion -- one field, every entry an opaque 32-byte token.)
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(eidB);
    const dailyKey = await getDailyKey(DAY);
    if (dailyKey) expect(serialised).not.toContain(dailyKey);

    // And no entry is anything but a string: no nested object could smuggle a count or a
    // time alongside a token.
    for (const entry of encounters) expect(typeof entry).toBe('string');
  });

  it('deletes the raw sightings and the daily key only after the upload succeeds', async () => {
    await seedRealDay();
    expect(await getDailyKey(DAY)).toBeTruthy();

    await uploadPresenceFor(DAY, { minWindows: 4, now: NOW });

    expect(await storedSightings(DAY)).toEqual([]);
    expect(await getDailyKey(DAY)).toBeNull();
  });

  it('keeps the sightings and the key when the upload fails', async () => {
    await seedRealDay();
    endpoints.uploadPresence.mockImplementation(async () => {
      const { ApiError } = jest.requireActual('@/api/client') as typeof import('@/api/client');
      throw new ApiError(500, 'server_error', 'nope');
    });

    const result = await uploadPresenceFor(DAY, { minWindows: 4, now: NOW });
    expect(result).toMatchObject({ status: 'rejected' });
    expect((await storedSightings(DAY)).length).toBe(1);
    expect(await getDailyKey(DAY)).toBeTruthy();
  });

  it('remembers the time block on the device, where only the device can see it', async () => {
    await seedRealDay();
    await uploadPresenceFor(DAY, { minWindows: 4, now: NOW });
    const [, body] = endpoints.uploadPresence.mock.calls[0] as [string, { encounters: string[] }];

    // Exactly one of the uploaded tokens has a local time block: the real one.
    const blocks = await Promise.all(body.encounters.map((t) => getEncounterTime(t)));
    const known = blocks.filter(Boolean);
    expect(known).toHaveLength(1);
    expect(known[0]).toMatchObject({ day: DAY, block: 'morning' }); // interval 40 = 10:00
  });

  it('never uploads the same day twice', async () => {
    await seedRealDay();
    await uploadPresenceFor(DAY, { minWindows: 4, now: NOW });
    expect(await uploadPresenceFor(DAY, { minWindows: 4, now: NOW })).toMatchObject({
      status: 'already_uploaded',
    });
    expect(endpoints.uploadPresence).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for a day with no qualifying sightings, and tidies up', async () => {
    await ensureLookahead(DAY);
    const own = await ownEid(DAY, 40);
    const adapter = {
      name: 'fake' as const,
      drain: async () => [
        { day: DAY, interval: 40, ownEid: own!, heardEid: 'brush', windows: 2 },
      ],
    } as unknown as FakeBle;
    await drainInto(adapter);

    const result = await uploadPresenceFor(DAY, { minWindows: 4, now: NOW });
    expect(result).toMatchObject({ status: 'nothing_to_send' });
    expect(endpoints.uploadPresence).not.toHaveBeenCalled();
    expect(await hasUploaded('presence', DAY)).toBe(true);
    expect(await getDailyKey(DAY)).toBeNull();
  });
});
