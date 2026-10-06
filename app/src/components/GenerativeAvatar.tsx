/**
 * GenerativeAvatar (SPEC.md §13.5): a soft, deterministic abstract shape derived from a
 * person's identity public key. Shown everywhere before a reveal.
 *
 * Why not a silhouette, a monogram or a blurred photo: all three invite the viewer to guess
 * at a face, which is exactly what this product withholds until a mutual match. An abstract
 * blob is pleasant, stable (the same person always looks the same), and tells you nothing.
 *
 * Determinism comes from BLAKE2b of the identity key, not from a string hash: the prototype
 * used a 32-bit FNV hash, which is fine for a browser mock but collides often enough to
 * matter across a campus. The palette and the blob construction are the prototype's,
 * unchanged (SPEC §13.9).
 */

import { blake2b } from '@noble/hashes/blake2.js';
import { b64urlDecode } from '@mutual/protocol';
import type { ReactNode } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

import { avatarPalette } from '@/design/tokens';

/**
 * A deterministic number stream from a BLAKE2b digest.
 *
 * The digest is 64 bytes, and the blob construction needs more values than that, so the
 * stream re-hashes with an incrementing counter when it runs out instead of cycling (which
 * would make the two blobs visibly related).
 */
function digestStream(seed: Uint8Array, personalization: string): () => number {
  const label = new TextEncoder().encode(personalization);
  let block = blake2b(concat(seed, label), { dkLen: 64 });
  let index = 0;
  let round = 0;

  return () => {
    if (index + 4 > block.length) {
      round += 1;
      block = blake2b(concat(block, new Uint8Array([round])), { dkLen: 64 });
      index = 0;
    }
    // 32 bits, big-endian, scaled to [0, 1).
    const value =
      ((block[index]! << 24) >>> 0) +
      (block[index + 1]! << 16) +
      (block[index + 2]! << 8) +
      block[index + 3]!;
    index += 4;
    return value / 4294967296;
  };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Three distinct colours, drawn without replacement, exactly as the prototype does. */
function pickColours(next: () => number): [string, string, string] {
  const pool = [...avatarPalette];
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]!);
  }
  return out as [string, string, string];
}

/**
 * A closed, smooth blob through `n` jittered points on a circle, as a cubic Bezier path.
 * Transcribed from the prototype's `blob()` so the shapes are the approved ones.
 */
function blobPath(
  next: () => number,
  cx: number,
  cy: number,
  radius: number,
  n: number,
): string {
  const points: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const angle = (k / n) * Math.PI * 2 + (next() - 0.5) * 0.4;
    const r = radius * (0.75 + next() * 0.4);
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(points[0]![0])} ${f(points[0]![1])}`;
  for (let k = 0; k < n; k++) {
    const p0 = points[(k - 1 + n) % n]!;
    const p1 = points[k]!;
    const p2 = points[(k + 1) % n]!;
    const p3 = points[(k + 2) % n]!;
    d +=
      ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)}` +
      ` ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)}` +
      ` ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

export interface AvatarShape {
  colours: [string, string, string];
  big: string;
  small: string;
}

/**
 * The avatar's geometry for an identity key. Exported so tests can assert determinism
 * without rendering, and so the Reveal moment can cross-fade from the exact same shape.
 *
 * @param identityPk the peer's identity public key, base64url as the server returns it
 */
export function avatarShape(identityPk: string): AvatarShape {
  // An unparseable key still has to render something: a missing avatar would leak which
  // rows are malformed, and there is nothing secret about the fallback.
  let seed: Uint8Array;
  try {
    seed = b64urlDecode(identityPk);
  } catch {
    seed = new TextEncoder().encode(identityPk);
  }

  const colours = pickColours(digestStream(seed, 'avatar-colour'));
  const shapeStream = digestStream(seed, 'avatar-shape');
  const big = blobPath(shapeStream, 44 + shapeStream() * 12, 46 + shapeStream() * 12, 36, 6);
  const small = blobPath(shapeStream, 28 + shapeStream() * 44, 26 + shapeStream() * 44, 17, 5);
  return { colours, big, small };
}

export interface GenerativeAvatarProps {
  /** The peer's identity public key, base64url. */
  identityPk: string;
  size: number;
  /** Square instead of round, for the Reveal moment's stage. */
  square?: boolean;
  /** Spoken name, for a screen reader. Omit inside a labelled row. */
  accessibilityLabel?: string;
}

export function GenerativeAvatar({
  identityPk,
  size,
  square = false,
  accessibilityLabel,
}: GenerativeAvatarProps): ReactNode {
  const { colours, big, small } = avatarShape(identityPk);
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ borderRadius: square ? 0 : size / 2 }}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
    >
      <Rect width={100} height={100} fill={colours[0]} />
      <Path d={big} fill={colours[1]} />
      <Path d={small} fill={colours[2]} opacity={0.9} />
    </Svg>
  );
}
