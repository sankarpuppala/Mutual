/**
 * The Kotlin radio constants must match `packages/protocol-spec/constants.json`.
 *
 * SPEC §6.2: "Both implementations load this file ... No constant is duplicated in code."
 * The native module cannot load a JSON file at build time the way Python and TypeScript do,
 * so `Schedule.kt` restates six of these values by hand. Nothing checked that they agreed.
 *
 * That is the mechanism by which CLAUDE.md invariant 8 breaks without anyone noticing: a
 * `protocol_version` bump that changes `ble.magic_hex` or `eid_interval_minutes` would
 * update the spec, the constants file, both language implementations and the vectors --
 * every one of which has a test -- and leave Kotlin quietly advertising the old format. The
 * two phones would then hear nothing from each other, and every test in the repository
 * would still pass.
 *
 * This test is the cross-check. It reads the Kotlin source as text rather than running it,
 * because running Kotlin is not something the JS suite can do; a mismatch here means
 * `Schedule.kt` needs the same edit the constants file just had.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONSTANTS = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'packages', 'protocol-spec', 'constants.json'), 'utf8'),
) as {
  eid_bytes: number;
  eid_interval_minutes: number;
  eid_intervals_per_day: number;
  ble: { company_id: number; magic_hex: string; payload_version: number };
};

const KOTLIN = readFileSync(
  join(__dirname, '..', 'modules', 'mutual-ble', 'android', 'src', 'main', 'java', 'app', 'mutual', 'ble', 'Schedule.kt'),
  'utf8',
);

/** The right-hand side of `const NAME = <value>` or `val NAME = <value>` in BleConstants. */
function kotlinValue(name: string): string {
  const match = new RegExp(`\\b(?:const\\s+)?val\\s+${name}\\s*(?::[^=]+)?=\\s*([^\\n]+)`).exec(KOTLIN);
  if (!match) throw new Error(`BleConstants.${name} not found in Schedule.kt`);
  return match[1]!.trim();
}

describe('BleConstants mirrors constants.json (SPEC §6.2, invariant 8)', () => {
  it('company id', () => {
    // Written in hex in Kotlin, decimal in the JSON.
    expect(Number(kotlinValue('COMPANY_ID'))).toBe(CONSTANTS.ble.company_id);
  });

  it('magic bytes', () => {
    const expected = CONSTANTS.ble.magic_hex
      .match(/../g)!
      .map((pair) => `0x${pair.toUpperCase()}`)
      .join(', ');
    expect(kotlinValue('MAGIC')).toBe(`byteArrayOf(${expected})`);
  });

  it('payload version', () => {
    expect(Number(kotlinValue('PAYLOAD_VERSION'))).toBe(CONSTANTS.ble.payload_version);
  });

  it('EID size and interval schedule', () => {
    expect(Number(kotlinValue('EID_BYTES'))).toBe(CONSTANTS.eid_bytes);
    expect(Number(kotlinValue('INTERVAL_MINUTES'))).toBe(CONSTANTS.eid_interval_minutes);
    expect(Number(kotlinValue('INTERVALS_PER_DAY'))).toBe(CONSTANTS.eid_intervals_per_day);
  });

  it('the full payload is magic + version + EID', () => {
    const magicBytes = CONSTANTS.ble.magic_hex.length / 2;
    expect(Number(kotlinValue('PAYLOAD_BYTES'))).toBe(magicBytes + 1 + CONSTANTS.eid_bytes);
  });

  it('names no constant for a layout that no longer exists', () => {
    // The split advertisement was withdrawn on 2026-10-07 (SPEC §14.2, DECISIONS_LOG 30).
    // Its constants going stale in Kotlin is exactly the drift this file exists to catch.
    expect(KOTLIN).not.toMatch(/LEGACY/);
  });
});
