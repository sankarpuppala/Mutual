/**
 * The in-app protocol self-test (PLAN.md Phase 8 task 3, risk R4/R5).
 *
 * Why it exists: the TypeScript protocol passes its vector suite under Node, but the app
 * runs under Hermes, with a different engine, a polyfilled CSPRNG and a bundler that could
 * in principle mangle `constants.json`. A green vitest run is not evidence that the bytes
 * are right *on the phone*. This runs real vectors inside the app and shows the result.
 *
 * It is deliberately strict: a single mismatched byte fails the whole check, because a
 * protocol that is almost right produces matches that silently never happen.
 */

import vectors from '../../../packages/protocol-spec/vectors.json';
import {
  b64urlDecode,
  b64urlEncode,
  eid,
  encounterToken,
  ephemeralPrivateKey,
  interestToken,
  isValidPublicKey,
  pairKey,
  randomBytes,
} from '@mutual/protocol';

/** Hex string to bytes. The vectors file stores every byte value as lowercase hex. */
function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export interface SelfTestCase {
  /** What was checked, in words: shown in the dev panel. */
  name: string;
  passed: boolean;
  /** Set only on failure, to make a byte mismatch legible. */
  detail?: string;
}

export interface SelfTestResult {
  ok: boolean;
  cases: SelfTestCase[];
  /** The protocol version the vectors were generated for. */
  protocolVersion: number;
}

interface PairKeyVector {
  sk_a: string;
  pk_a: string;
  uid_a: string;
  pk_b: string;
  uid_b: string;
  pair_key: string;
}
interface InterestVector {
  pair_key: string;
  epoch: string;
  intent: string;
  token: string;
}
interface EidVector {
  daily_key: string;
  interval: number;
  eid: string;
  esk: string;
}
interface EncounterVector {
  day: string;
  esk_a: string;
  eid_a: string;
  eid_b: string;
  token: string;
}
interface ValidityVector {
  public_key: string;
  valid: boolean;
}
interface B64Vector {
  bytes: string;
  b64url: string;
}

interface VectorsFile {
  protocol_version: number;
  pair_key: PairKeyVector[];
  interest_token: InterestVector[];
  eid: EidVector[];
  encounter_token: EncounterVector[];
  public_key_validity: ValidityVector[];
  base64url: B64Vector[];
}

const file = vectors as unknown as VectorsFile;

function check(name: string, actual: string, expected: string): SelfTestCase {
  const passed = actual === expected;
  return passed ? { name, passed } : { name, passed, detail: `got ${actual}, want ${expected}` };
}

/**
 * Runs two vectors from each of the five derivations plus base64url: ten protocol vectors
 * in all, as the plan asks for, picked from the start and the middle of each list so a
 * bundling accident that truncates the file is caught.
 */
export function runProtocolSelfTest(): SelfTestResult {
  const cases: SelfTestCase[] = [];

  for (const index of [0, Math.floor(file.pair_key.length / 2)]) {
    const v = file.pair_key[index]!;
    const actual = pairKey(
      fromHex(v.sk_a),
      fromHex(v.pk_a),
      v.uid_a,
      fromHex(v.pk_b),
      v.uid_b,
    );
    cases.push(check(`pair key #${index}`, toHex(actual), v.pair_key));
  }

  for (const index of [0, Math.floor(file.interest_token.length / 2)]) {
    const v = file.interest_token[index]!;
    const actual = interestToken(fromHex(v.pair_key), v.epoch, v.intent);
    cases.push(check(`interest token #${index} (${v.intent})`, toHex(actual), v.token));
  }

  for (const index of [0, Math.floor(file.eid.length / 2)]) {
    const v = file.eid[index]!;
    const actualEid = eid(fromHex(v.daily_key), v.interval);
    const actualEsk = ephemeralPrivateKey(fromHex(v.daily_key), v.interval);
    cases.push(check(`EID #${index} (interval ${v.interval})`, toHex(actualEid), v.eid));
    cases.push(check(`ephemeral key #${index}`, toHex(actualEsk), v.esk));
  }

  for (const index of [0, Math.floor(file.encounter_token.length / 2)]) {
    const v = file.encounter_token[index]!;
    const actual = encounterToken(v.day, fromHex(v.esk_a), fromHex(v.eid_a), fromHex(v.eid_b));
    cases.push(check(`encounter token #${index}`, toHex(actual), v.token));
  }

  for (const v of file.public_key_validity.slice(0, 2)) {
    const actual = isValidPublicKey(fromHex(v.public_key));
    cases.push(check(`key validity ${v.public_key.slice(0, 8)}…`, String(actual), String(v.valid)));
  }

  for (const v of file.base64url.slice(0, 2)) {
    const encoded = b64urlEncode(fromHex(v.bytes));
    cases.push(check(`base64url encode "${v.b64url || '(empty)'}"`, encoded, v.b64url));
    cases.push(check(`base64url decode "${v.b64url || '(empty)'}"`, toHex(b64urlDecode(v.b64url)), v.bytes));
  }

  // The CSPRNG itself: without it, padding would be predictable and claim C1 would fail.
  try {
    const a = randomBytes(32);
    const b = randomBytes(32);
    const distinct = toHex(a) !== toHex(b) && !a.every((x) => x === 0);
    cases.push({
      name: 'CSPRNG returns distinct non-zero bytes',
      passed: distinct,
      detail: distinct ? undefined : 'the polyfill is missing or returning zeros',
    });
  } catch (error) {
    cases.push({
      name: 'CSPRNG available',
      passed: false,
      detail: error instanceof Error ? error.message : 'unknown error',
    });
  }

  return {
    ok: cases.every((c) => c.passed),
    cases,
    protocolVersion: file.protocol_version,
  };
}
