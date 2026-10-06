/**
 * Design tokens (SPEC.md §13.4). Every colour, space, radius, size and duration in the app
 * comes from this file -- components never contain a raw hex value or a magic number
 * (enforced by eslint.config.js and `npm run lint`).
 *
 * The values are taken from `docs/design/prototype.html`, the approved visual reference
 * (SPEC §13.9). Where the prototype and §13.4 differ on a look-and-feel value, the
 * prototype wins, and the difference is noted in a comment.
 *
 * `npm run check:contrast` verifies every text/background pair used here.
 */

export type ThemeName = 'light' | 'dark';

export interface Colors {
  /** Screen background: warm paper by day, ink by night. */
  bg: string;
  /** Cards. */
  surface: string;
  /** Inputs, sheets, chips, the voice player's tray. */
  surfaceSunk: string;
  /** Primary text. */
  ink: string;
  /** Secondary text. Never the only carrier of meaning (SPEC §13.7). */
  inkMuted: string;
  /** Hairline borders and dividers. */
  hairline: string;
  /** The act of signalling, and nothing else (terracotta). */
  signal: string;
  /** Backgrounds behind signal states. */
  signalSoft: string;
  /** Mutual moments only, and nothing else (indigo). */
  mutual: string;
  /** Backgrounds behind mutual states. */
  mutualSoft: string;
  /** Block, report, delete. */
  danger: string;
  /** Text and icons on a `signal` fill. */
  onSignal: string;
  /** Text and icons on a `mutual` fill. */
  onMutual: string;
  /** Behind sheets. */
  scrim: string;
}

const light: Colors = {
  bg: '#F7F3EE',
  surface: '#FFFFFF',
  surfaceSunk: '#EFE9E1',
  ink: '#1D1A22',
  inkMuted: '#5F5868',
  hairline: '#E3DCD2',
  signal: '#B5523F',
  signalSoft: '#F6E3DD',
  mutual: '#4F4FC4',
  mutualSoft: '#E6E6FA',
  danger: '#A3333D',
  onSignal: '#FFFFFF',
  onMutual: '#FFFFFF',
  scrim: 'rgba(20,16,26,0.36)',
};

const dark: Colors = {
  bg: '#121016',
  surface: '#1B1820',
  surfaceSunk: '#16131B',
  ink: '#F2EEF6',
  inkMuted: '#A49DAE',
  hairline: '#2C2733',
  signal: '#F08A72',
  signalSoft: '#3A2420',
  mutual: '#9A9AF2',
  mutualSoft: '#25244A',
  danger: '#F2808A',
  onSignal: '#1D1A22',
  onMutual: '#121016',
  scrim: 'rgba(0,0,0,0.55)',
};

export const colors: Record<ThemeName, Colors> = { light, dark };

/**
 * The GenerativeAvatar palette (SPEC §13.5), from the prototype's `PAL`. Warm and muted,
 * with no primary colours, so a wall of avatars stays calm.
 *
 * Deliberately theme-independent: an avatar is how you recognise a person before a reveal,
 * and it would be disorienting for it to change colour when the phone switches to dark mode.
 * Every entry is light enough to sit under the dark blob shapes drawn on top of it.
 */
export const avatarPalette = [
  '#F2B880',
  '#E58F73',
  '#C9A3D6',
  '#8FB3E0',
  '#86C9B7',
  '#EBCF7A',
  '#A99BE8',
  '#F4A7A0',
  '#9FD08F',
  '#73B4C9',
  '#E7A3C4',
  '#B9C98A',
] as const;

/** Spacing scale in points (SPEC §13.4). Nothing in the app uses a value outside it. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Type sizes in points (SPEC §13.4). */
export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
  xxxl: 36,
} as const;

/**
 * Display sizes used by the prototype that sit between the §13.4 steps. They are listed
 * here rather than written inline so the lint rule stays honest; each is annotated with
 * the prototype element it comes from.
 */
export const displaySize = {
  /** `.welcome-title` */
  welcome: 42,
  /** `.display-name` */
  name: 38,
  /** `.how-text h1` */
  howTitle: 32,
  /** `.h-title`, `.brand-name` */
  title: 30,
  /** `.pcard .a` */
  promptAnswerLarge: 27,
  /** `.display-name.sm`, `.sheet-title`, `.count strong` */
  nameSmall: 26,
  /** `.empty h2` */
  emptyTitle: 24,
  /** `.a` -- a prompt answer on a card */
  promptAnswer: 23,
  /** `.mcard-body p` */
  mutualBody: 20,
  /** `.context .a` -- chat context */
  chatContext: 19,
  /** `.reassure` */
  reassure: 17,
} as const;

/** Line heights as multipliers (SPEC §13.4): display is tighter than body. */
export const lineHeight = { display: 1.35, body: 1.5 } as const;

/** Corner radii in points (SPEC §13.4). */
export const radius = {
  card: 20,
  sheet: 28,
  pill: 999,
  /** `.voice`, `.banner`, `.toast` in the prototype. */
  tray: 16,
  /** `.bubble` */
  bubble: 20,
  /** `.prompt`, `.tab` focus targets. */
  sm: 12,
} as const;

/** The one soft shadow level (SPEC §13.4). React Native needs platform-shaped values. */
export const shadow: Record<ThemeName, object> = {
  light: {
    shadowColor: '#1D1A22',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  dark: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
};

/** Minimum touch target in points (SPEC §13.7). */
export const hitSize = 44;

/** Letter spacing for the display face, from the prototype's CSS. */
export const tracking = {
  welcome: -0.025,
  name: -0.02,
  title: -0.015,
  tight: -0.01,
  answer: -0.005,
  /** `.eyebrow`, `.section-h`, `.ctl-label`: uppercase, widely spaced. */
  eyebrow: 0.1,
} as const;
