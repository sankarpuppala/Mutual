/**
 * AC-T2-4: every text/background pair the app actually uses must reach WCAG AA contrast in
 * both themes (SPEC.md §13.4) -- 4.5:1 for body text, 3:1 for large text (>= 18 pt, or
 * bold >= 14 pt).
 *
 * Run with `npm run check:contrast -w app`.
 *
 * The pairs below are listed by hand on purpose. A script that scanned the code would miss
 * pairs that only occur at runtime, and would quietly stop checking anything if the scan
 * broke. This list is the contract; when a screen introduces a new pair, it is added here.
 */

import { colors, type Colors, type ThemeName } from '../src/design/tokens';

type Level = 'body' | 'large';

interface Pair {
  /** Where this combination appears, so a failure says what to go and look at. */
  where: string;
  fg: keyof Colors;
  bg: keyof Colors;
  level: Level;
}

/** Every text/background combination used by the design (prototype + SPEC §13.4). */
const PAIRS: Pair[] = [
  // Body text on the three background levels.
  { where: 'primary text on the screen background', fg: 'ink', bg: 'bg', level: 'body' },
  { where: 'primary text on a card', fg: 'ink', bg: 'surface', level: 'body' },
  { where: 'primary text on a sheet or input', fg: 'ink', bg: 'surfaceSunk', level: 'body' },
  { where: 'secondary text on the screen background', fg: 'inkMuted', bg: 'bg', level: 'body' },
  { where: 'secondary text on a card', fg: 'inkMuted', bg: 'surface', level: 'body' },
  {
    where: 'time chip and voice tray labels (surfaceSunk)',
    fg: 'inkMuted',
    bg: 'surfaceSunk',
    level: 'body',
  },

  // Filled buttons and their text.
  { where: 'text on a signal-filled button', fg: 'onSignal', bg: 'signal', level: 'body' },
  { where: 'text on a mutual-filled button', fg: 'onMutual', bg: 'mutual', level: 'body' },
  { where: 'text on an ink-filled button (toast, Get started)', fg: 'bg', bg: 'ink', level: 'body' },
  { where: 'text on a danger-filled button', fg: 'surface', bg: 'danger', level: 'body' },

  // Soft backgrounds carrying ink text: intent pills, signal-sent chips, mutual cards.
  { where: 'intent pill text on signalSoft', fg: 'ink', bg: 'signalSoft', level: 'body' },
  { where: 'intent pill text on mutualSoft', fg: 'ink', bg: 'mutualSoft', level: 'body' },
  { where: 'mutual card body text on mutualSoft', fg: 'ink', bg: 'mutualSoft', level: 'large' },
  {
    where: 'mutual card eyebrow on mutualSoft (small caps, semibold)',
    fg: 'mutual',
    bg: 'mutualSoft',
    level: 'large',
  },

  // Accent colours used as text rather than as fills.
  { where: '"Your turn" marker in mutual indigo', fg: 'mutual', bg: 'bg', level: 'large' },
  { where: 'the italic word in the welcome title', fg: 'signal', bg: 'bg', level: 'large' },
  { where: 'destructive row labels (Delete account, Block)', fg: 'danger', bg: 'surface', level: 'body' },
  { where: 'destructive row labels on a sheet', fg: 'danger', bg: 'surface', level: 'body' },

  // Chat bubbles.
  { where: "own message text in a bubble", fg: 'onMutual', bg: 'mutual', level: 'body' },
  { where: "peer message text in a bubble", fg: 'ink', bg: 'surface', level: 'body' },
];

/** sRGB relative luminance (WCAG 2.1). */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channel = (pair: string) => {
    const c = Number.parseInt(pair, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(value.slice(0, 2));
  const g = channel(value.slice(2, 4));
  const b = channel(value.slice(4, 6));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colours. */
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

const MINIMUM: Record<Level, number> = { body: 4.5, large: 3 };

interface Failure {
  theme: ThemeName;
  pair: Pair;
  ratio: number;
}

const failures: Failure[] = [];
const rows: string[] = [];

for (const theme of ['light', 'dark'] as const) {
  for (const pair of PAIRS) {
    const fg = colors[theme][pair.fg];
    const bg = colors[theme][pair.bg];
    if (fg.startsWith('rgba') || bg.startsWith('rgba')) continue; // scrim only; not a text pair
    const ratio = contrastRatio(fg, bg);
    const need = MINIMUM[pair.level];
    const ok = ratio >= need;
    rows.push(
      `${ok ? 'ok  ' : 'FAIL'} ${theme.padEnd(5)} ${ratio.toFixed(2).padStart(5)}:1 ` +
        `(needs ${need}) ${pair.fg} on ${pair.bg} — ${pair.where}`,
    );
    if (!ok) failures.push({ theme, pair, ratio });
  }
}

console.log(rows.join('\n'));

if (failures.length > 0) {
  console.error(`\nContrast check FAILED: ${failures.length} pair(s) below WCAG AA.\n`);
  for (const { theme, pair, ratio } of failures) {
    console.error(
      `  - ${theme}: ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, needs ` +
        `${MINIMUM[pair.level]}:1 (${pair.where})`,
    );
  }
  console.error(
    '\nAdjust the token in src/design/tokens.ts AND the table in SPEC.md §13.4 together.\n',
  );
  process.exit(1);
}

console.log(`\nContrast OK: ${PAIRS.length} pairs x 2 themes, all at or above WCAG AA.`);
