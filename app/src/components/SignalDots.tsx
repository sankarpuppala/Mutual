/**
 * SignalDots (SPEC.md §13.5, §13.9): twenty dots, filled for the signals in use.
 *
 * It exists because "14 of 20 signals free" is a number, and twenty dots is a glance. The
 * cap is a privacy parameter (the padded set holds exactly 20, SPEC §6.7), so it is worth
 * making legible rather than hiding in a counter.
 *
 * The sheet variant adds a third state: dots about to be filled by the choice being made,
 * drawn in `signal` so the cost of confirming is visible before confirming.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/design/theme';
import { space } from '@/design/tokens';

export interface SignalDotsProps {
  /** Signals already in use. */
  used: number;
  /** Total slots. Always `SIGNAL_CAP`; a parameter so a test can use a smaller grid. */
  total: number;
  /** Slots the pending choice would add, drawn in `signal`. */
  pending?: number;
  /** The small inline variant used inside the signal sheet. */
  compact?: boolean;
}

export function SignalDots({
  used,
  total,
  pending = 0,
  compact = false,
}: SignalDotsProps): ReactNode {
  const theme = useTheme();
  const free = Math.max(0, total - used - pending);

  return (
    <View
      style={[styles.grid, compact ? styles.gridCompact : styles.gridFull]}
      accessibilityRole="image"
      accessibilityLabel={
        pending > 0
          ? `${used} of ${total} signals in use, ${pending} about to be added, ${free} free`
          : `${used} of ${total} signals in use, ${free} free`
      }
    >
      {Array.from({ length: total }, (_, i) => {
        const state = i < used ? 'used' : i < used + pending ? 'pending' : 'free';
        return (
          <View
            key={i}
            style={[
              compact ? styles.dotCompact : styles.dot,
              {
                borderColor:
                  state === 'free'
                    ? theme.colors.hairline
                    : state === 'pending'
                      ? theme.colors.signal
                      : compact
                        ? theme.colors.inkMuted
                        : theme.colors.signal,
                backgroundColor:
                  state === 'free'
                    ? 'transparent'
                    : state === 'pending'
                      ? theme.colors.signal
                      : compact
                        ? theme.colors.inkMuted
                        : theme.colors.signal,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridFull: { gap: 9 },
  gridCompact: { gap: 5 },
  // The full grid is ten per row; the dot sizes come from the prototype's `.dots` and
  // `.mini-dots`.
  dot: { width: '7%', aspectRatio: 1, borderRadius: space.sm, borderWidth: 2 },
  dotCompact: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
});
