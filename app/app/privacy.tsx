/**
 * "What Mutual can and can never see" (screen S12, SPEC.md §13.2, §13.6).
 *
 * The copy is taken verbatim from the approved prototype and is not paraphrased here: it is
 * the plainest statement of the project's privacy claims that a user will ever read, and it
 * has to stay true to `docs/SECURITY_ARGUMENT.md`. If a claim here ever stops being true,
 * that is a spec change, not a copy edit.
 */

import { SIGNAL_SET_SIZE } from '@mutual/protocol';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PrivacyRow } from '@/components/PrivacyRow';
import { Icon } from '@/design/icons';
import { AppText, GUTTER, Screen } from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { hitSize, radius, space } from '@/design/tokens';

const CAN_SEE = [
  'Your first name, your year, and the answers, voice notes and photos you add.',
  'Which day you crossed paths with someone. Only the day, and only for 7 days.',
  `That your phone sent its nightly set of ${SIGNAL_SET_SIZE} signals. Every set looks the same.`,
  'Your mutuals, and the messages inside them.',
  'Blocks and reports you choose to make.',
  'Feedback you choose to send the Mutual team.',
];

const CAN_NEVER_SEE = [
  'Your email address or your date of birth.',
  'Where you are, or any place you have been.',
  'Who you signalled, or whether you signalled anyone at all.',
  'Why you signalled: study, project, fitness, friend or date.',
  'Which cards you opened or which voice notes you played.',
  'The time of day you crossed paths with someone.',
];

export default function PrivacyScreen(): ReactNode {
  const theme = useTheme();
  return (
    <Screen testID="privacy">
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <Icon name="back" />
        </Pressable>
      </View>

      <AppText variant="title" accessibilityRole="header" style={styles.title}>
        What Mutual can and can never see
      </AppText>

      <AppText variant="sectionTitle" accessibilityRole="header" style={styles.heading}>
        Mutual can see
      </AppText>
      <View>
        {CAN_SEE.map((text, i) => (
          <PrivacyRow key={text} text={text} kind="can" last={i === CAN_SEE.length - 1} />
        ))}
      </View>

      <AppText variant="sectionTitle" accessibilityRole="header" style={styles.heading}>
        Mutual can never see
      </AppText>
      <View>
        {CAN_NEVER_SEE.map((text, i) => (
          <PrivacyRow
            key={text}
            text={text}
            kind="never"
            last={i === CAN_NEVER_SEE.length - 1}
          />
        ))}
      </View>

      <AppText variant="small" tone="muted" center style={styles.footnote}>
        Mutual is an unaudited research prototype.
      </AppText>
      <AppText variant="tiny" tone="muted" center>
        Chat inside a mutual is not end-to-end encrypted, so the server can read it. Nothing
        else on this page depends on trusting us: it is how the protocol is built.
      </AppText>
      <View style={{ height: space.lg, backgroundColor: theme.colors.bg }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', marginHorizontal: -GUTTER + space.sm, marginTop: -space.sm },
  iconButton: {
    width: hitSize,
    height: hitSize,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { marginTop: space.sm },
  heading: { marginTop: space.xl + 2, marginBottom: space.xs + 2 },
  footnote: { marginTop: space.xl + space.xs, marginBottom: space.sm },
});
