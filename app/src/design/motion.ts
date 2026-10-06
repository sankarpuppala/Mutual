/**
 * Motion (SPEC.md §13.4): three durations, one easing curve, and an absolute rule that the
 * OS reduce-motion setting wins (SPEC §13.7).
 *
 * `useMotion()` returns durations already collapsed to 0 when reduce-motion is on, so a
 * component never has to remember to check. The Reveal moment in particular must be
 * instant rather than a 900 ms dissolve for a user who asked for less motion.
 */

import { Easing } from 'react-native-reanimated';

import { useReduceMotion } from './theme';

/** Durations in milliseconds (SPEC §13.4). */
export const duration = {
  /** Button presses, chip toggles, waveform bars. */
  micro: 180,
  /** Sheets sliding up, scrims fading. */
  sheet: 320,
  /** The Reveal moment only. */
  reveal: 900,
} as const;

/** The single easing curve, matching the prototype's `cubic-bezier(.2,.7,.2,1)`. */
export const ease = Easing.bezier(0.2, 0.7, 0.2, 1);

export interface Motion {
  micro: number;
  sheet: number;
  reveal: number;
  /** True when the OS asked for reduced motion; screens use it for layout-level choices. */
  reduced: boolean;
}

/** Durations for the current accessibility setting. All zero when reduce-motion is on. */
export function useMotion(): Motion {
  const reduced = useReduceMotion();
  if (reduced) return { micro: 0, sheet: 0, reveal: 0, reduced: true };
  return { ...duration, reduced: false };
}
