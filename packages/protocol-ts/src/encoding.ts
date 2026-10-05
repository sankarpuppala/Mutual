/** Byte encodings (SPEC.md §6.3), on plain Uint8Array (no Node byte classes) so they run under Hermes. */
import { UID_BYTES } from './constants';

/** Raised when an input violates SPEC.md §6 (mirrors protocol_py's ProtocolError). */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const DECODE = new Map<string, number>([...ALPHABET].map((ch, i) => [ch, i]));

/** Encode bytes as base64url without padding. */
export function b64urlEncode(data: Uint8Array): string {
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const b0 = data[i]!;
    const b1 = data[i + 1];
    const b2 = data[i + 2];
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== undefined) out += ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 !== undefined) out += ALPHABET[b2 & 0x3f];
  }
  return out;
}

/** Decode strict, canonical base64url without padding (same rules as protocol_py). */
export function b64urlDecode(text: string): Uint8Array {
  if (text.length % 4 === 1) throw new ProtocolError('invalid base64url');
  const values: number[] = [];
  for (const ch of text) {
    const v = DECODE.get(ch);
    if (v === undefined) throw new ProtocolError('invalid base64url');
    values.push(v);
  }
  const out = new Uint8Array(Math.floor((values.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (const v of values) {
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  if (b64urlEncode(out) !== text) throw new ProtocolError('non-canonical base64url');
  return out;
}

const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** The 10 ASCII bytes of a YYYY-MM-DD day or epoch, after checking it is a real date. */
export function dayBytes(day: string): Uint8Array {
  if (typeof day !== 'string' || !DAY.test(day)) {
    throw new ProtocolError(`day must be YYYY-MM-DD, got ${JSON.stringify(day)}`);
  }
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new ProtocolError(`not a calendar date: ${day}`);
  }
  const out = new Uint8Array(10);
  for (let i = 0; i < 10; i++) out[i] = day.charCodeAt(i);
  return out;
}

/** Encode 0 ≤ value ≤ 65535 as 2 big-endian bytes. */
export function uint16be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new ProtocolError(`uint16 out of range: ${value}`);
  }
  return new Uint8Array([value >> 8, value & 0xff]);
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** A canonical UUID string as 16 raw bytes in RFC 4122 order (SPEC.md §6.3). */
export function uidBytes(uid: string): Uint8Array {
  if (!UUID.test(uid)) throw new ProtocolError(`invalid user id: ${uid}`);
  const hex = uid.replace(/-/g, '');
  const out = new Uint8Array(UID_BYTES);
  for (let i = 0; i < UID_BYTES; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** Concatenate byte arrays. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Lexicographic comparison of raw bytes (unsigned), as Python compares bytes. */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/** Constant-time equality for equal-length secrets. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
