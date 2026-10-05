import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ENCOUNTER_MAX_ENTRIES,
  ENCOUNTER_PAD_BLOCK,
  EID_INTERVALS_PER_DAY,
  INTENTS,
  PERSON_ENCOUNTER,
  PERSON_EID,
  PERSON_INTEREST,
  PERSON_PAIR_KEY,
  ProtocolError,
  SIGNAL_SET_SIZE,
  b64urlDecode,
  dayBytes,
  eid,
  eidSchedule,
  encounterToken,
  ephemeralPrivateKey,
  generateIdentityKeypair,
  interestToken,
  intervalFor,
  isMidnightInterval,
  isValidPublicKey,
  newDailyKey,
  pairKey,
  paddedEncounterSet,
  paddedSet,
  paddedSize,
  publicKey,
  randBelow,
  randomBytes,
  toHex,
  uidBytes,
  uint16be,
} from '../src/index';

const uuid = (): string => crypto.randomUUID();
const DAY = '2026-10-05';

describe('constants', () => {
  it('every personalization is 16 bytes', () => {
    for (const p of [PERSON_PAIR_KEY, PERSON_INTEREST, PERSON_EID, PERSON_ENCOUNTER]) expect(p.length).toBe(16);
  });
});

describe('encoding', () => {
  it('rejects bad base64url, days, uint16 and uids', () => {
    for (const bad of ['AA==', 'AB+/', 'A', 'AAA=', 'a b', 'AB']) expect(() => b64urlDecode(bad)).toThrow(ProtocolError);
    for (const bad of ['2026-13-01', '2026-02-30', '26-10-05', '2026/10/05', '２０２６-10-05', '']) {
      expect(() => dayBytes(bad)).toThrow(ProtocolError);
    }
    expect(dayBytes(DAY).length).toBe(10);
    expect(() => uint16be(-1)).toThrow(ProtocolError);
    expect(() => uint16be(0x10000)).toThrow(ProtocolError);
    expect(toHex(uint16be(95))).toBe('005f');
    expect(() => uidBytes('not-a-uuid')).toThrow(ProtocolError);
  });

  it('round-trips random bytes of every length 0..39', () => {
    for (let n = 0; n < 40; n++) {
      const b = randomBytes(n);
      expect(toHex(b64urlDecode(encodeUrl(b)))).toBe(toHex(b));
    }
  });
});

function encodeUrl(b: Uint8Array): string {
  // Independent oracle for the round trip: Node's base64url (tests only).
  return Buffer.from(b).toString('base64url');
}

describe('pair key', () => {
  it('is symmetric over 1000 random pairs', () => {
    for (let i = 0; i < 1000; i++) {
      const a = generateIdentityKeypair();
      const b = generateIdentityKeypair();
      const ua = uuid();
      const ub = uuid();
      const k = pairKey(a.secretKey, a.publicKey, ua, b.publicKey, ub);
      expect(toHex(pairKey(b.secretKey, b.publicKey, ub, a.publicKey, ua))).toBe(toHex(k));
    }
  });

  it('changes with either uid, and when uids are swapped', () => {
    const a = generateIdentityKeypair();
    const b = generateIdentityKeypair();
    const ua = uuid();
    const ub = uuid();
    const base = toHex(pairKey(a.secretKey, a.publicKey, ua, b.publicKey, ub));
    expect(toHex(pairKey(a.secretKey, a.publicKey, uuid(), b.publicKey, ub))).not.toBe(base);
    expect(toHex(pairKey(a.secretKey, a.publicKey, ua, b.publicKey, uuid()))).not.toBe(base);
    expect(toHex(pairKey(a.secretKey, a.publicKey, ub, b.publicKey, ua))).not.toBe(base);
  });

  it('rejects identical keys, identical uids and a foreign own key', () => {
    const a = generateIdentityKeypair();
    const b = generateIdentityKeypair();
    const u = uuid();
    expect(() => pairKey(a.secretKey, a.publicKey, uuid(), a.publicKey, uuid())).toThrow(/identical public keys/);
    expect(() => pairKey(a.secretKey, a.publicKey, u, b.publicKey, u)).toThrow(/identical user ids/);
    expect(() => pairKey(a.secretKey, b.publicKey, uuid(), a.publicKey, uuid())).toThrow(/does not belong/);
  });

  it('rejects the top-bit alias of a valid key', () => {
    const { publicKey: pk } = generateIdentityKeypair();
    const alias = Uint8Array.from(pk);
    alias[31] = alias[31]! | 0x80;
    expect(isValidPublicKey(pk)).toBe(true);
    expect(isValidPublicKey(alias)).toBe(false);
  });
});

describe('interest tokens and the padded set', () => {
  it('5100 tokens across pairs, epochs and intents have no collisions', () => {
    const seen = new Set<string>();
    const epochs = ['2026-10-05', '2026-10-06', '2026-12-31'];
    for (let i = 0; i < 340; i++) {
      const k = randomBytes(32);
      for (const e of epochs) for (const intent of Object.keys(INTENTS)) seen.add(toHex(interestToken(k, e, intent)));
    }
    expect(seen.size).toBe(340 * 3 * Object.keys(INTENTS).length);
  });

  it('rejects unknown intents', () => {
    for (const bad of ['love', 0, 6, 255]) expect(() => interestToken(new Uint8Array(32), DAY, bad)).toThrow(ProtocolError);
  });

  it('has exactly 20 tokens of 32 bytes containing every real one', () => {
    for (const n of [0, 1, 7, SIGNAL_SET_SIZE]) {
      const real = Array.from({ length: n }, () => randomBytes(32));
      const s = paddedSet(real);
      expect(s.length).toBe(SIGNAL_SET_SIZE);
      expect(s.every((t) => t.length === 32)).toBe(true);
      const set = new Set(s.map(toHex));
      expect(real.every((t) => set.has(toHex(t)))).toBe(true);
    }
  });

  it('raises above 20 real tokens, on bad lengths and on duplicates', () => {
    expect(() => paddedSet(Array.from({ length: SIGNAL_SET_SIZE + 1 }, () => randomBytes(32)))).toThrow(ProtocolError);
    expect(() => paddedSet([new Uint8Array(31)])).toThrow(ProtocolError);
    const t = randomBytes(32);
    expect(() => paddedSet([t, t])).toThrow(ProtocolError);
  });

  it('places the real token in every slot over 2000 sets', () => {
    const t = randomBytes(32);
    const positions = new Set<number>();
    for (let i = 0; i < 2000; i++) positions.add(paddedSet([t]).findIndex((x) => toHex(x) === toHex(t)));
    expect(positions.size).toBe(SIGNAL_SET_SIZE);
  });

  it('randBelow stays in range and covers it', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const x = randBelow(7);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(7);
      seen.add(x);
    }
    expect(seen.size).toBe(7);
  });
});

describe('EIDs', () => {
  it('gives 96 distinct valid public keys per daily key', () => {
    for (let n = 0; n < 20; n++) {
      const sched = eidSchedule(newDailyKey());
      expect(sched.map(([i]) => i)).toEqual([...Array(EID_INTERVALS_PER_DAY).keys()]);
      expect(new Set(sched.map(([, e]) => toHex(e))).size).toBe(EID_INTERVALS_PER_DAY);
      expect(sched.every(([, e]) => isValidPublicKey(e))).toBe(true);
    }
    const dk = newDailyKey();
    expect(toHex(eid(dk, 5))).toBe(toHex(publicKey(ephemeralPrivateKey(dk, 5))));
  });

  it('maps local time to intervals and flags the midnight intervals', () => {
    const cases: Array<[number, number, number]> = [[0, 0, 0], [0, 14, 0], [0, 15, 1], [8, 0, 32], [23, 44, 94], [23, 59, 95]];
    for (const [hh, mm, i] of cases) expect(intervalFor(hh, mm)).toBe(i);
    expect(isMidnightInterval(0) && isMidnightInterval(95)).toBe(true);
    expect([...Array(94).keys()].some((i) => isMidnightInterval(i + 1))).toBe(false);
    expect(() => eid(newDailyKey(), 96)).toThrow(ProtocolError);
  });
});

describe('encounter tokens', () => {
  const device = (): { esk: Uint8Array; id: Uint8Array } => {
    const dk = newDailyKey();
    return { esk: ephemeralPrivateKey(dk, 40), id: eid(dk, 40) };
  };

  it('are the same on both devices', () => {
    for (let i = 0; i < 200; i++) {
      const a = device();
      const b = device();
      expect(toHex(encounterToken(DAY, a.esk, a.id, b.id))).toBe(toHex(encounterToken(DAY, b.esk, b.id, a.id)));
    }
  });

  it('cannot be reproduced by a listener with a different key', () => {
    const a = device();
    const b = device();
    const m = device();
    const real = toHex(encounterToken(DAY, a.esk, a.id, b.id));
    expect(toHex(encounterToken(DAY, m.esk, m.id, b.id))).not.toBe(real);
    expect(toHex(encounterToken(DAY, m.esk, m.id, a.id))).not.toBe(real);
  });

  it('change with the day and reject bad EIDs', () => {
    const a = device();
    const b = device();
    expect(toHex(encounterToken('2026-10-06', a.esk, a.id, b.id))).not.toBe(toHex(encounterToken(DAY, a.esk, a.id, b.id)));
    for (const bad of [new Uint8Array(32), Uint8Array.from([1, ...new Uint8Array(31)]), new Uint8Array(32).fill(0xff)]) {
      expect(() => encounterToken(DAY, a.esk, a.id, bad)).toThrow(ProtocolError);
    }
    expect(() => encounterToken(DAY, a.esk, a.id, a.id)).toThrow(/identical/);
  });

  it('pad to multiples of 256 up to 1024', () => {
    for (const [n, size] of [[0, 256], [1, 256], [256, 256], [257, 512], [ENCOUNTER_MAX_ENTRIES, 1024]] as const) {
      expect(paddedSize(n)).toBe(size);
    }
    const real = Array.from({ length: 300 }, () => randomBytes(32));
    const s = paddedEncounterSet(real);
    expect(s.length % ENCOUNTER_PAD_BLOCK).toBe(0);
    const set = new Set(s.map(toHex));
    expect(set.size).toBe(s.length);
    expect(real.every((t) => set.has(toHex(t)))).toBe(true);
    expect(() => paddedEncounterSet(Array.from({ length: ENCOUNTER_MAX_ENTRIES + 1 }, () => randomBytes(32)))).toThrow(
      ProtocolError,
    );
  });
});

describe('Hermes safety of src/', () => {
  it('uses no Node-only APIs and no Math.random', () => {
    const dir = fileURLToPath(new URL('../src/', import.meta.url));
    const forbidden = [/\bBuffer\b/, /from ['"]node:/, /from ['"](fs|crypto|path|os)['"]/, /require\(/, /Math\.random/, /\bfetch\(/];
    for (const file of readdirSync(dir)) {
      const text = readFileSync(dir + file, 'utf8');
      for (const re of forbidden) expect(re.test(text), `${file} matches ${re}`).toBe(false);
    }
  });
});
