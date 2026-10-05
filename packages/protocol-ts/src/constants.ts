/**
 * Protocol constants (SPEC.md §6.2), imported from packages/protocol-spec/constants.json.
 * The JSON file is the single source of truth; nothing here duplicates a value.
 */
import data from '../../protocol-spec/constants.json';

const PERSON_SIZE = 16; // BLAKE2b personalization size in bytes (RFC 7693)

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) throw new Error(`non-ASCII personalization: ${text}`);
    out[i] = code;
  }
  return out;
}

function person(name: keyof typeof data.personalization): Uint8Array {
  const bytes = ascii(data.personalization[name]);
  if (bytes.length !== PERSON_SIZE) {
    throw new Error(`personalization ${name} must be exactly ${PERSON_SIZE} ASCII bytes, got ${bytes.length}`);
  }
  return bytes;
}

export const PROTOCOL_VERSION: number = data.protocol_version;
export const SIGNAL_SET_SIZE: number = data.signal_set_size;
export const TOKEN_BYTES: number = data.token_bytes;
export const PAIR_KEY_BYTES: number = data.pair_key_bytes;
export const DAILY_KEY_BYTES: number = data.daily_key_bytes;
export const EID_BYTES: number = data.eid_bytes;
export const EID_INTERVAL_MINUTES: number = data.eid_interval_minutes;
export const EID_INTERVALS_PER_DAY: number = data.eid_intervals_per_day;
export const ENCOUNTER_BYTES: number = data.encounter_bytes;
export const ENCOUNTER_PAD_BLOCK: number = data.encounter_pad_block;
export const ENCOUNTER_MAX_ENTRIES: number = data.encounter_max_entries;
export const UID_BYTES: number = data.uid_bytes;

export const PERSON_PAIR_KEY = person('pair_key');
export const PERSON_INTEREST = person('interest');
export const PERSON_EID = person('eid');
export const PERSON_ENCOUNTER = person('encounter');

export const INTENTS: Readonly<Record<string, number>> = Object.freeze({ ...data.intents });

if (EID_INTERVALS_PER_DAY * EID_INTERVAL_MINUTES !== 24 * 60) {
  throw new Error('eid_intervals_per_day × eid_interval_minutes must equal one day');
}
const codes = Object.values(INTENTS);
if (new Set(codes).size !== codes.length || !codes.every((c) => Number.isInteger(c) && c > 0 && c < 256)) {
  throw new Error('intent codes must be distinct integers in 1..255');
}
