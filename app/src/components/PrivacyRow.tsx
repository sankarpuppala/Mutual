/**
 * One line of the privacy screen (SPEC.md §13.5): an eye for what Mutual can see, a
 * crossed-out eye for what it can never see, and the sentence itself.
 *
 * Colour is never the only signal (SPEC §13.7): the two lists have different icons and sit
 * under their own headings, so the distinction survives in greyscale and for a
 * screen-reader user.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/design/icons';
import { AppText, Hairline } from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { space } from '@/design/tokens';

export function PrivacyRow({
  text,
  kind,
  last = false,
}: {
  text: string;
  /** `can` = Mutual can see this; `never` = Mutual can never see this. */
  kind: 'can' | 'never';
  last?: boolean;
}): ReactNode {
  const theme = useTheme();
  return (
    <View>
      <View
        style={styles.row}
        accessible
        accessibilityLabel={`${kind === 'can' ? 'Mutual can see' : 'Mutual can never see'}: ${text}`}
      >
        <View style={styles.icon}>
          <Icon
            name={kind === 'can' ? 'eye' : 'eyeoff'}
            size={20}
            color={kind === 'can' ? theme.colors.inkMuted : theme.colors.mutual}
          />
        </View>
        <AppText variant="body" style={styles.text}>
          {text}
        </AppText>
      </View>
      {last ? null : <Hairline />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.md, alignItems: 'flex-start' },
  icon: { marginTop: 2 },
  text: { flex: 1 },
});
