/**
 * The design system's own invariants (SPEC.md §13.4, §13.7). Cheap to check, and they fail
 * loudly if a token is edited in one theme without its counterpart in the other.
 */
import { colors, hitSize, space } from '@/design/tokens';
import { type } from '@/design/typography';

describe('design tokens', () => {
  it('defines exactly the same token names in both themes', () => {
    expect(Object.keys(colors.light).sort()).toEqual(Object.keys(colors.dark).sort());
  });

  it('gives every colour a usable value', () => {
    // Collected rather than asserted one by one, so a failure names every offender at once.
    const malformed: string[] = [];
    for (const theme of ['light', 'dark'] as const) {
      for (const [name, value] of Object.entries(colors[theme])) {
        if (!/^(#[0-9A-Fa-f]{6}|rgba\()/.test(value)) malformed.push(`${theme}.${name}=${value}`);
      }
    }
    expect(malformed).toEqual([]);
  });

  it('keeps the 44 pt minimum touch target', () => {
    expect(hitSize).toBe(44);
  });

  it('uses only the documented spacing scale', () => {
    expect(Object.values(space)).toEqual([4, 8, 12, 16, 24, 32, 48]);
  });

  it('gives every text style a family, a size and a line height', () => {
    const incomplete = Object.entries(type)
      .filter(([, s]) => !s.fontFamily || !(s.fontSize > 0) || !(s.lineHeight > 0))
      .map(([name]) => name);
    expect(incomplete).toEqual([]);
  });
});
