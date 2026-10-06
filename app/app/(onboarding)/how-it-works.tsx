/**
 * How it works (SPEC.md §13.2, §13.9): three panels, then on to the email step (journey J1).
 *
 * The three sentences are the prototype's, unchanged. They are the only place in the app
 * where the privacy design is explained before someone commits to it, and each panel leads
 * with the reassurance rather than the feature: "never GPS", "photos come later", "nobody
 * ever learns it existed".
 */

import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GenerativeAvatar } from '@/components/GenerativeAvatar';
import { Logo } from '@/design/icons';
import { AppText, Card, LinkButton, Button } from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { type } from '@/design/typography';

const PANELS = [
  {
    title: 'Your phone notices, quietly.',
    body:
      'Over Bluetooth, never GPS. Mutual never knows places, never shows a live map, and ' +
      'never tells anyone who is nearby right now.',
  },
  {
    title: 'A letter every morning.',
    body:
      'At 8, see the people you spent a little time near yesterday. You meet them through ' +
      'their answers. Photos come later.',
  },
  {
    title: 'Signals stay secret.',
    body:
      'Send one for study, project, fitness, friend or date. If it isn’t returned for ' +
      'the same thing, nobody ever learns it existed. Not them, and not us.',
  },
] as const;

/** Stand-in keys for the illustration, so the avatars are stable between renders. */
const ART_KEYS = ['how-panel-a', 'how-panel-b'] as const;

export default function HowItWorksScreen(): ReactNode {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const panel = PANELS[step]!;

  const next = (): void => {
    if (step < PANELS.length - 1) setStep(step + 1);
    else router.push('/(onboarding)/email');
  };

  return (
    <View
      testID="how-it-works"
      style={[
        styles.screen,
        {
          backgroundColor: theme.colors.bg,
          paddingTop: insets.top + space.sm,
          paddingBottom: insets.bottom + space.xl + 2,
        },
      ]}
    >
      <LinkButton label="Skip" onPress={() => router.push('/(onboarding)/email')} />

      <View style={styles.art}>
        {step === 0 ? (
          <View style={styles.artPair}>
            <GenerativeAvatar identityPk={ART_KEYS[0]} size={84} />
            <View style={[styles.waves, { backgroundColor: theme.colors.inkMuted }]} />
            <GenerativeAvatar identityPk={ART_KEYS[1]} size={84} />
          </View>
        ) : step === 1 ? (
          <Card style={styles.letter}>
            <AppText variant="promptQuestion" tone="muted">
              My simple pleasures
            </AppText>
            <AppText style={type.chatContext}>
              The first sip of filter coffee before an 8 am lab.
            </AppText>
          </Card>
        ) : (
          <Logo size={150} />
        )}
      </View>

      <View
        style={styles.steps}
        accessibilityRole="progressbar"
        accessibilityLabel={`Step ${step + 1} of ${PANELS.length}`}
      >
        {PANELS.map((p, i) => (
          <View
            key={p.title}
            style={[
              styles.dot,
              {
                backgroundColor: i === step ? theme.colors.ink : theme.colors.hairline,
                width: i === step ? 20 : 6,
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.text}>
        <AppText variant="howTitle" accessibilityRole="header">
          {panel.title}
        </AppText>
        <AppText variant="body" tone="muted">
          {panel.body}
        </AppText>
      </View>

      <Button
        label={step < PANELS.length - 1 ? 'Next' : 'Continue'}
        kind="ink"
        wide
        onPress={next}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: space.xl + 2 },
  art: { height: 250, alignItems: 'center', justifyContent: 'center' },
  artPair: { flexDirection: 'row', alignItems: 'center', gap: space.md - 2 },
  waves: { width: 64, height: 2, opacity: 0.6 },
  letter: { width: 220, transform: [{ rotate: '-3deg' }], gap: space.xs + 2 },
  steps: { flexDirection: 'row', gap: space.xs + 2, marginBottom: space.lg + 2 },
  dot: { height: 6, borderRadius: radius.pill },
  text: { flex: 1, gap: space.md },
});
