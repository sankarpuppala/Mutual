/**
 * GenerativeAvatar's geometry (SPEC.md §13.5).
 *
 * The avatar has to be *stable*: the same person must look the same every time, on every
 * device, or the product's main pre-reveal identifier becomes noise. It also has to be
 * *distinct enough* that two people in one digest do not look like the same blob.
 */

import { avatarShape } from '@/components/GenerativeAvatar';

const KEY_A = 'dGhpcyBpcyBub3QgYSByZWFsIGtleSBidXQgaXQgaXMgMzIgYnl0ZXM';
const KEY_B = 'YW5vdGhlciB2YWx1ZSB0aGF0IGlzIGFsc28gMzIgYnl0ZXMgbG9uZw';

describe('avatarShape', () => {
  it('is deterministic for a given identity key', () => {
    expect(avatarShape(KEY_A)).toEqual(avatarShape(KEY_A));
  });

  it('gives different keys different colours or shapes', () => {
    const a = avatarShape(KEY_A);
    const b = avatarShape(KEY_B);
    expect([a.colours, a.big, a.small]).not.toEqual([b.colours, b.big, b.small]);
  });

  it('picks three distinct colours from the palette', () => {
    const { colours } = avatarShape(KEY_A);
    expect(colours).toHaveLength(3);
    expect(new Set(colours).size).toBe(3);
    for (const colour of colours) expect(colour).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('builds closed paths, so the blob never renders as an open curve', () => {
    const { big, small } = avatarShape(KEY_A);
    for (const path of [big, small]) {
      expect(path.startsWith('M')).toBe(true);
      expect(path.endsWith('Z')).toBe(true);
      expect(path).toContain('C');
    }
  });

  it('keeps the two blobs different from each other', () => {
    const { big, small } = avatarShape(KEY_A);
    expect(big).not.toEqual(small);
  });

  it('still renders something for a key it cannot decode', () => {
    // A malformed key must not produce a missing avatar: an empty space in a digest would
    // show which rows are malformed, and the fallback is not secret.
    const shape = avatarShape('not base64url !!!');
    expect(shape.colours).toHaveLength(3);
    expect(shape.big.endsWith('Z')).toBe(true);
  });

  it('spreads colours across the palette rather than favouring the first entries', () => {
    const used = new Set<string>();
    for (let i = 0; i < 40; i++) used.add(avatarShape(`key-${i}`).colours[0]);
    // 12 colours in the palette; a broken stream would collapse this to one or two.
    expect(used.size).toBeGreaterThanOrEqual(6);
  });
});
