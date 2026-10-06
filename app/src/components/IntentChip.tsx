/**
 * IntentChip (SPEC.md §13.5): one of the five reasons to signal, as a selectable chip in the
 * signal sheet.
 *
 * Selection is shown three ways at once -- a tick, a tinted fill and a coloured border --
 * because colour is never the only signal (SPEC §13.7), and because `aria-pressed` alone is
 * invisible to a sighted user who cannot distinguish the tint.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from '@/design/icons';
import { AppText } from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { hitSize, radius, space } from '@/design/tokens';

export interface IntentChipProps {
  label: string;
  selected: boolean;
  /** True when the cap is reached and this chip is not already selected. */
  disabled?: boolean;
  onPress: () => void;
}

export function IntentChip({
  label,
  selected,
  disabled = false,
  onPress,
}: IntentChipProps): ReactNode {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: selected ? theme.colors.signal : theme.colors.hairline,
          backgroundColor: selected ? theme.colors.signalSoft : 'transparent',
          paddingLeft: selected ? space.md + 2 : space.lg + 2,
        },
        disabled && styles.disabled,
      ]}
    >
      {selected ? (
        <Icon name="check" size={16} strokeWidth={2.2} color={theme.colors.signal} />
      ) : null}
      <AppText variant="bodyMedium">{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    minHeight: hitSize,
    paddingRight: space.lg + 2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  disabled: { opacity: 0.38 },
});
