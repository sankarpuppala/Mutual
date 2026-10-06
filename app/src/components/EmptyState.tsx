/**
 * EmptyState (SPEC.md §13.5, §13.6): the screens where nothing has happened yet.
 *
 * These matter more in this app than in most, because "nothing happened" is the normal
 * state on many mornings and is not a failure. The copy says what the app is doing and what
 * the user can expect, and never nudges ("invite friends", "keep checking"). The exact
 * sentences for Today's three states are in SPEC §13.6 and are used verbatim.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/design/icons';
import { AppText } from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { space } from '@/design/tokens';

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  body: string;
}

export function EmptyState({ icon, title, body }: EmptyStateProps): ReactNode {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Icon name={icon} size={40} strokeWidth={1.4} color={theme.colors.inkMuted} />
      <AppText variant="emptyTitle" center accessibilityRole="header">
        {title}
      </AppText>
      <AppText variant="body" tone="muted" center style={styles.body}>
        {body}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xxl + space.xs,
    paddingBottom: space.sm,
    paddingHorizontal: space.md,
  },
  body: { maxWidth: 320 },
});
